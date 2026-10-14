const debug = require('debug')('extract-zip')
// eslint-disable-next-line node/no-unsupported-features/node-builtins
const { createWriteStream, promises: fs } = require('fs')
const getStream = require('get-stream')
const path = require('path')
const { promisify } = require('util')
const stream = require('stream')
const yauzl = require('yauzl')

const openZip = promisify(yauzl.open)
const pipeline = promisify(stream.pipeline)

async function resolveCanonicalPath (candidate) {
  let current = candidate
  const missing = []

  while (true) {
    try {
      return path.resolve(await fs.realpath(current), ...missing)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      const parent = path.dirname(current)
      if (parent === current) throw err
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

class Extractor {
  constructor (zipPath, opts) {
    this.zipPath = zipPath
    this.opts = opts
  }

  async extract () {
    debug('opening', this.zipPath, 'with opts', this.opts)

    this.zipfile = await openZip(this.zipPath, { lazyEntries: true })
    this.canceled = false

    return new Promise((resolve, reject) => {
      this.zipfile.on('error', err => {
        this.canceled = true
        reject(err)
      })
      this.zipfile.readEntry()

      this.zipfile.on('close', () => {
        if (!this.canceled) {
          debug('zip extraction complete')
          resolve()
        }
      })

      this.zipfile.on('entry', async entry => {
        /* istanbul ignore if */
        if (this.canceled) {
          debug('skipping entry', entry.fileName, { cancelled: this.canceled })
          return
        }

        debug('zipfile entry', entry.fileName)

        const resolvedDest = path.resolve(this.opts.dir, entry.fileName)
        const relativeDest = path.relative(this.opts.dir, resolvedDest)
        if (relativeDest === '' || relativeDest === '..' || relativeDest.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDest)) {
          this.canceled = true
          this.zipfile.close()
          reject(new Error(`Out of bound path found while processing file ${entry.fileName}`))
          return
        }

        if (entry.fileName.startsWith('__MACOSX/')) {
          this.zipfile.readEntry()
          return
        }

        const destDir = path.dirname(path.join(this.opts.dir, entry.fileName))

        try {
          await fs.mkdir(destDir, { recursive: true })

          const canonicalDestDir = await fs.realpath(destDir)
          const relativeDestDir = path.relative(this.opts.dir, canonicalDestDir)

          if (relativeDestDir.split(path.sep).includes('..')) {
            throw new Error(`Out of bound path "${canonicalDestDir}" found while processing file ${entry.fileName}`)
          }

          await this.extractEntry(entry)
          debug('finished processing', entry.fileName)
          this.zipfile.readEntry()
        } catch (err) {
          this.canceled = true
          this.zipfile.close()
          reject(err)
        }
      })
    })
  }

  async extractEntry (entry) {
    /* istanbul ignore if */
    if (this.canceled) {
      debug('skipping entry extraction', entry.fileName, { cancelled: this.canceled })
      return
    }

    if (this.opts.onEntry) {
      this.opts.onEntry(entry, this.zipfile)
    }

    const dest = path.join(this.opts.dir, entry.fileName)

    // convert external file attr int into a fs stat mode int
    const mode = (entry.externalFileAttributes >> 16) & 0xFFFF
    // check if it's a symlink or dir (using stat mode constants)
    const IFMT = 61440
    const IFDIR = 16384
    const IFLNK = 40960
    const symlink = (mode & IFMT) === IFLNK
    let isDir = (mode & IFMT) === IFDIR

    // Failsafe, borrowed from jsZip
    if (!isDir && entry.fileName.endsWith('/')) {
      isDir = true
    }

    // check for windows weird way of specifying a directory
    // https://github.com/maxogden/extract-zip/issues/13#issuecomment-154494566
    const madeBy = entry.versionMadeBy >> 8
    if (!isDir) isDir = (madeBy === 0 && entry.externalFileAttributes === 16)

    debug('extracting entry', { filename: entry.fileName, isDir: isDir, isSymlink: symlink })

    const procMode = this.getExtractedMode(mode, isDir) & 0o777

    // always ensure folders are created
    const destDir = isDir ? dest : path.dirname(dest)

    const mkdirOptions = { recursive: true }
    if (isDir) {
      mkdirOptions.mode = procMode
    }
    debug('mkdir', { dir: destDir, ...mkdirOptions })
    await fs.mkdir(destDir, mkdirOptions)
    if (isDir) return

    debug('opening read stream', dest)
    if (symlink) {
      const readStream = await promisify(this.zipfile.openReadStream.bind(this.zipfile))(entry)
      const link = await getStream(readStream)
      const resolvedLink = path.resolve(path.dirname(dest), link)
      const canonicalLink = await resolveCanonicalPath(resolvedLink)
      const relativeLink = path.relative(this.opts.dir, canonicalLink)

      if (relativeLink === '..' || relativeLink.startsWith(`..${path.sep}`) || path.isAbsolute(relativeLink)) {
        throw new Error(`Out of bound symlink target "${link}" found while processing file ${entry.fileName}`)
      }

      debug('creating symlink', link, dest)
      await fs.symlink(link, dest)
    } else {
      let existing
      try {
        existing = await fs.lstat(dest)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }

      if (existing) {
        if (existing.isSymbolicLink() || !existing.isFile()) {
          throw new Error(`Refusing to overwrite a non-regular file ${dest}`)
        }
        await fs.unlink(dest)
      }

      // Exclusive creation is portable and cannot follow a symlink inserted
      // after lstat. Remove an existing regular archive entry above to retain
      // the historical behavior for duplicate regular filenames.
      const readStream = await promisify(this.zipfile.openReadStream.bind(this.zipfile))(entry)
      const output = createWriteStream(dest, { mode: procMode, flags: 'wx' })
      await pipeline(readStream, output)
    }
  }

  getExtractedMode (entryMode, isDir) {
    let mode = entryMode
    // Set defaults, if necessary
    if (mode === 0) {
      if (isDir) {
        if (this.opts.defaultDirMode) {
          mode = parseInt(this.opts.defaultDirMode, 10)
        }

        if (!mode) {
          mode = 0o755
        }
      } else {
        if (this.opts.defaultFileMode) {
          mode = parseInt(this.opts.defaultFileMode, 10)
        }

        if (!mode) {
          mode = 0o644
        }
      }
    }

    return mode
  }
}

module.exports = async function (zipPath, opts) {
  debug('creating target directory', opts.dir)

  if (!path.isAbsolute(opts.dir)) {
    throw new Error('Target directory is expected to be absolute')
  }

  await fs.mkdir(opts.dir, { recursive: true })
  opts.dir = await fs.realpath(opts.dir)
  return new Extractor(zipPath, opts).extract()
}
