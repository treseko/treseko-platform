import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button, Form } from 'react-bootstrap';
import { Radio, Upload } from 'lucide-react';
import { preferRecordedBaseUrl } from './automationScriptUtils';

type Props = { context: any };

function removeDuplicateCaseCode(title: string, code: string) {
  if (!code) return title;
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`^${escapedCode}(?=\\s|$)[\\s·:–—-]*`, 'i'), '').trim();
}

export function TresekoFlowScriptImport({ context }: Props) {
  const [importMessage, setImportMessage] = useState('');
  const {
    t, setNewTestFramework, setNewTestLanguage, setNewTestScript,
    newTestScript, newTestTitle, editingCaseCode, confirmAction,
  } = context;
  const caseTitle = removeDuplicateCaseCode(String(newTestTitle || '').trim(), String(editingCaseCode || ''));
  const caseDisplayTitle = caseTitle || (!editingCaseCode ? t('casos.recorderNewCase') : '');
  const caseLabel = [editingCaseCode, caseDisplayTitle].filter(Boolean).join(' · ');
  const receivedNonces = useRef(new Set<string>());

  useEffect(() => {
    const bridgeWindow = window as Window & {
      __TRESEKO_FLOW_RECEIVE__?: (payload: unknown) => boolean;
      __TRESEKO_FLOW_READY__?: boolean;
      __TRESEKO_FLOW_CASE__?: { code: string; title: string };
    };
    const receive = (payload: unknown) => {
      window.dispatchEvent(new CustomEvent('treseko-flow-import-script', { detail: payload }));
      return true;
    };
    bridgeWindow.__TRESEKO_FLOW_RECEIVE__ = receive;
    bridgeWindow.__TRESEKO_FLOW_READY__ = true;
    bridgeWindow.__TRESEKO_FLOW_CASE__ = {
      code: String(editingCaseCode || '').slice(0, 80),
      title: caseTitle.slice(0, 160),
    };
    const receiveFromExtension = (event: Event) => {
      const message = event as CustomEvent<{ script?: unknown; nonce?: unknown; name?: unknown }>;
      const payload = message.detail;
      if (!payload || typeof payload.script !== 'string' || payload.script.length > 200_000 || !payload.script.trim()) return;
      if (typeof payload.nonce !== 'string' || !payload.nonce || receivedNonces.current.has(payload.nonce)) return;
      receivedNonces.current.add(payload.nonce);
      void (async () => {
        if (String(newTestScript || '').trim()) {
          const replace = await confirmAction({
            title: t('casos.recorderFlowReplaceTitle'),
            message: t('casos.recorderFlowReplaceMessage'),
            variant: 'warning',
            confirmLabel: t('casos.recorderFlowReplaceConfirm'),
            cancelLabel: t('casos.cancel'),
          });
          if (!replace) return;
        }
        setNewTestFramework('playwright');
        setNewTestLanguage('javascript');
        setNewTestScript(preferRecordedBaseUrl(payload.script as string));
        setImportMessage(t('casos.recorderFlowReceived', { file: typeof payload.name === 'string' ? payload.name : 'el script' }));
      })();
    };
    window.addEventListener('treseko-flow-import-script', receiveFromExtension);
    return () => {
      window.removeEventListener('treseko-flow-import-script', receiveFromExtension);
      if (bridgeWindow.__TRESEKO_FLOW_RECEIVE__ === receive) {
        delete bridgeWindow.__TRESEKO_FLOW_RECEIVE__;
        delete bridgeWindow.__TRESEKO_FLOW_READY__;
        delete bridgeWindow.__TRESEKO_FLOW_CASE__;
      }
    };
  }, [caseDisplayTitle, confirmAction, editingCaseCode, newTestScript, setNewTestFramework, setNewTestLanguage, setNewTestScript]);

  const importFlowScript = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!/\.spec\.js$|\.js$/i.test(file.name) || file.size > 200_000) {
      setImportMessage(t('casos.recorderImportFileError'));
      return;
    }
    try {
      const script = await file.text();
      if (!script.trim()) throw new Error('empty');
      setNewTestFramework('playwright');
      setNewTestLanguage('javascript');
      setNewTestScript(preferRecordedBaseUrl(script));
      setImportMessage(t('casos.recorderImportFileSuccess', { file: file.name }));
    } catch {
      setImportMessage(t('casos.recorderImportFileError'));
    }
  };

  return (
    <section className="d-flex flex-wrap align-items-center gap-2" aria-label={t('casos.recordWithPlaywright')} data-treseko-flow-ready="true">
      {caseLabel && <span className="small fw-semibold text-secondary me-1">{caseLabel}</span>}
      <Button
        type="button"
        variant="outline-primary"
        size="sm"
        className="d-inline-flex align-items-center gap-2"
        onClick={() => setImportMessage(t('casos.recorderOpenExtensionHint'))}
      >
        <Radio size={15} aria-hidden="true" />{t('casos.recordWithPlaywright')}
      </Button>
      <Form.Label htmlFor="treseko-flow-script-import" className="btn btn-link btn-sm text-decoration-none mb-0 d-inline-flex align-items-center gap-1">
        <Upload size={14} aria-hidden="true" />{t('casos.recorderImportShort')}
      </Form.Label>
      <Form.Control
        id="treseko-flow-script-import"
        type="file"
        accept=".js,.spec.js"
        className="visually-hidden"
        onChange={importFlowScript}
        aria-label={t('casos.recorderImportExtension')}
      />
      {importMessage && <span className="small text-muted" role="status">{importMessage}</span>}
    </section>
  );
}
