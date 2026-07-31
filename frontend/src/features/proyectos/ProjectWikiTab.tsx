import { Badge, Button, Card, Form, Table } from 'react-bootstrap'
import { ArrowLeft, Edit, FileText, History, Plus, Save, Trash2 } from 'lucide-react'
import { WikiMarkdownViewer } from './WikiMarkdownViewer'

export function ProjectWikiTab({ context }: { context: any }) {
  const {
    t, canEditProjectWikiEffective, setSelectedWiki, setWikiFormData, setWikiMode,
    wikiPages, managingProjectId, handleDeleteWikiPage, wikiMode, selectedWiki, wikiFormData,
    handleSaveWikiPage,
  } = context
  return (
<div className="animate__animated animate__fadeIn h-100 d-flex flex-column">

                      {/* MODO LISTA: Directorio de todas las Wikis del proyecto */}
                      {wikiMode === 'list' && (
                        <>
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                            <div>
                              <h5 className="fw-bold text-dark m-0">{t('proyectos.docDirectory')}</h5>
                              <span className="text-muted small">{t('proyectos.docDirectorySubtitle')}</span>
                            </div>
                            {canEditProjectWikiEffective && (
                              <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1" onClick={() => {
                                setSelectedWiki(null);
                                setWikiFormData({ title: '', content: '' });
                                setWikiMode('edit');
                              }}>
                                <Plus size={16} /> {t('proyectos.newPage')}
                              </Button>
                            )}
                          </div>

                          <div className="flex-grow-1 overflow-auto">
                            <Table responsive hover className="align-middle border shadow-sm rounded-3 overflow-hidden bg-white">
                              <thead className="bg-light text-muted small">
                                <tr>
                                  <th className="py-3 px-3 border-0">{t('proyectos.docTitle')}</th>
                                  <th className="py-3 border-0">{t('proyectos.docLastModified')}</th>
                                  <th className="py-3 border-0">{t('proyectos.docAuthor')}</th>
                                  <th className="py-3 px-3 border-0 text-end">{t('proyectos.docActions')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {wikiPages.filter(w => w.projectId === managingProjectId).map(wiki => (
                                  <tr key={wiki.id} className="border-bottom">
                                    <td className="px-3">
                                      <div className="fw-bold text-primary cursor-pointer d-flex align-items-center gap-2 hover-text-dark" onClick={() => { setSelectedWiki(wiki); setWikiMode('view'); }}>
                                        <FileText size={16} /> {wiki.title}
                                      </div>
                                    </td>
                                    <td className="text-muted small font-monospace">{wiki.lastEditedAt}</td>
                                    <td><Badge bg="secondary" className="fw-normal">{wiki.lastEditedBy}</Badge></td>
                                    <td className="px-3 text-end d-flex gap-2 justify-content-end">
                                      <Button variant="light" size="sm" className="border shadow-none text-muted" title={t('proyectos.history')} onClick={() => { setSelectedWiki(wiki); setWikiMode('history'); }}><History size={14} /></Button>
                                      {canEditProjectWikiEffective && <Button variant="light" size="sm" className="border shadow-none text-primary" title={t('proyectos.editDoc')} onClick={() => { setSelectedWiki(wiki); setWikiFormData({ title: wiki.title, content: wiki.content }); setWikiMode('edit'); }}><Edit size={14} /></Button>}
                                      {canEditProjectWikiEffective && <Button variant="light" size="sm" className="border shadow-none text-danger" title={t('proyectos.delete')} onClick={() => handleDeleteWikiPage(wiki.id)}><Trash2 size={14} /></Button>}
                                    </td>
                                  </tr>
                                ))}
                                {wikiPages.filter(w => w.projectId === managingProjectId).length === 0 && (
                                  <tr><td colSpan={4} className="text-center py-4 text-muted small">{t('proyectos.noDocuments')}</td></tr>
                                )}
                              </tbody>
                            </Table>
                          </div>
                        </>
                      )}

                      {/* MODO LECTURA: Ver un documento renderizado */}
                      {wikiMode === 'view' && selectedWiki && (
                        <div className="d-flex flex-column h-100">
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 flex-shrink-0">
                            <div className="d-flex align-items-center gap-3">
                              <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setWikiMode('list')}><ArrowLeft size={16} /></Button>
                              <h5 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><FileText size={20} className="text-primary" /> {selectedWiki.title}</h5>
                            </div>
                            <div className="d-flex gap-2">
                              <Button variant="outline-secondary" size="sm" className="fw-bold rounded-pill px-3 shadow-none d-flex align-items-center gap-1" onClick={() => setWikiMode('history')}><History size={14} /> {t('proyectos.history')}</Button>
                              {canEditProjectWikiEffective && <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1" onClick={() => { setWikiFormData({ title: selectedWiki.title, content: selectedWiki.content }); setWikiMode('edit'); }}><Edit size={14} /> {t('proyectos.editDoc')}</Button>}
                            </div>
                          </div>
                          <Card className="border-0 shadow-sm bg-white flex-grow-1 overflow-auto">
                            <Card.Body className="p-5">
                              <div className="bg-light p-2 rounded-2 mb-4 d-flex justify-content-between align-items-center border border-light-subtle">
                                <span className="x-small text-muted fw-bold text-uppercase ms-2">{t('proyectos.markdownFormat')}</span>
                                <span className="small text-muted me-2">{t('proyectos.updatedBy', { author: selectedWiki.lastEditedBy, date: selectedWiki.lastEditedAt })}</span>
                              </div>
                              <WikiMarkdownViewer content={selectedWiki.content} />
                            </Card.Body>
                          </Card>
                        </div>
                      )}

                      {/* MODO EDICIÓN / CREACIÓN */}
                      {wikiMode === 'edit' && canEditProjectWikiEffective && (
                        <div className="d-flex flex-column h-100">
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 flex-shrink-0">
                            <div className="d-flex align-items-center gap-3">
                              <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setWikiMode('list')}><ArrowLeft size={16} /></Button>
                              <h5 className="fw-bold text-dark m-0">{selectedWiki ? t('proyectos.editDocument') : t('proyectos.newDocument')}</h5>
                            </div>
                            <Button variant="success" size="sm" className="fw-bold rounded-pill px-4 shadow-sm d-flex align-items-center gap-2" onClick={handleSaveWikiPage}>
                              <Save size={16} /> {t('proyectos.saveChangesDoc')}
                            </Button>
                          </div>
                          <div className="flex-grow-1 d-flex flex-column gap-3">
                            <Form.Control size="lg" type="text" placeholder={t('proyectos.documentTitle')} className="fw-bold border-light-subtle shadow-sm" value={wikiFormData.title} onChange={(e) => setWikiFormData({ ...wikiFormData, title: e.target.value })} />
                            <div className="flex-grow-1 position-relative">
                              <Form.Control as="textarea" placeholder={t('proyectos.markdownHint')} className="h-100 font-monospace bg-light border-light-subtle shadow-sm p-4 app-small" style={{ resize: 'none' }} value={wikiFormData.content} onChange={(e) => setWikiFormData({ ...wikiFormData, content: e.target.value })} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* MODO HISTORIAL (TIMELINE) */}
                      {wikiMode === 'history' && selectedWiki && (
                        <div className="d-flex flex-column h-100">
                          <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 flex-shrink-0">
                            <div className="d-flex align-items-center gap-3">
                              <Button variant="white" size="sm" className="border shadow-sm rounded-circle p-2" onClick={() => setWikiMode('view')}><ArrowLeft size={16} /></Button>
                              <h5 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><History size={20} className="text-secondary" /> {t('proyectos.historyOf', { title: selectedWiki.title })}</h5>
                            </div>
                          </div>
                          <Card className="border-0 shadow-sm bg-white flex-grow-1 overflow-auto">
                            <Card.Body className="p-3">
                              <div className="timeline-container px-3">
                                {selectedWiki.history.map((entry: any, i: number) => (
                                  <div key={i} className="d-flex gap-3 mb-4 position-relative">
                                    {/* Línea vertical conectora */}
                                    {i !== selectedWiki.history.length - 1 && (
                                      <div className="position-absolute bg-secondary opacity-25" style={{ width: '2px', top: '30px', bottom: '-20px', left: '19px' }}></div>
                                    )}
                                    <div className="rounded-circle bg-primary text-white d-flex justify-content-center align-items-center shadow-sm z-1 flex-shrink-0" style={{ width: '40px', height: '40px' }}>
                                      <Edit size={16} />
                                    </div>
                                    <div className="bg-light border border-light-subtle rounded-3 p-3 flex-grow-1 shadow-sm">
                                      <div className="d-flex justify-content-between mb-1">
                                        <strong className="text-dark">{entry.author}</strong>
                                        <span className="font-monospace text-muted x-small">{entry.date}</span>
                                      </div>
                                      <span className="small text-secondary">{entry.action}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </Card.Body>
                          </Card>
                        </div>
                      )}

                    </div>
  )
}
