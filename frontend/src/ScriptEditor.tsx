import { useEffect, useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { Badge, Button } from 'react-bootstrap'
import { Info } from 'lucide-react'
import { APP_EDITOR_FONT_SIZE } from './shared/ui/typography'
import { useI18n } from './i18n'

type ScriptEditorProps = {
  value: string
  onChange: (value: string) => void
  framework: string
  language?: string
  projectId?: string
  suiteId?: string
  readOnly?: boolean
  confirmAction?: (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>
}

export const ScriptEditor = ({
  value,
  onChange,
  framework,
  language,
  projectId,
  suiteId,
  readOnly = false,
  confirmAction
}: ScriptEditorProps) => {
  const { t } = useI18n()
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)

  const getLanguage = () => {
    if (language === 'typescript') return 'typescript'
    if (language === 'python') return 'python'
    if (language === 'java') return 'java'
    if (language === 'csharp') return 'csharp'
    if (language === 'ruby') return 'ruby'
    if (language === 'javascript') return 'javascript'
    switch (framework) {
      case 'playwright':
      case 'cypress':
      case 'puppeteer':
        return 'javascript'
      case 'selenium':
        return 'python'
      default:
        return 'javascript'
    }
  }

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Configurar autocompletado personalizado
    monaco.languages.registerCompletionItemProvider(getLanguage(), {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }

        const suggestions: any[] = []

        // Autocompletado de variables {{VARIABLE}}
        suggestions.push({
          label: '{{URL_BASE}}',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: '{{URL_BASE}}',
          range,
          detail: t('automatizacion.editorVariableBaseUrl')
        })

        suggestions.push({
          label: '{{USUARIO_TEST}}',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: '{{USUARIO_TEST}}',
          range,
          detail: t('automatizacion.editorVariableUser')
        })

        suggestions.push({
          label: '{{PASSWORD_TEST}}',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: '{{PASSWORD_TEST}}',
          range,
          detail: t('automatizacion.editorVariablePassword')
        })

        // Autocompletado de funciones comunes (ejemplo)
        if (framework === 'playwright') {
          suggestions.push({
            label: 'login',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'login(${1:usuario}, ${2:password})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: t('automatizacion.editorFunctionLogin'),
            documentation: t('automatizacion.editorFunctionLoginDescription')
          })

          suggestions.push({
            label: 'logout',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'logout()',
            range,
            detail: t('automatizacion.editorFunctionLogout')
          })

          suggestions.push({
            label: 'navegar_a',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'navegar_a(${1:ruta})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: t('automatizacion.editorFunctionNavigate')
          })
        }

        return { suggestions }
      }
    })

    // Resaltado especial para {{VARIABLES}}
    monaco.languages.setMonarchTokensProvider(getLanguage(), {
      tokenizer: {
        root: [
          [/\{\{[A-Z_]+\}\}/, 'variable.custom']
        ]
      }
    })
  }

  const getPlaceholder = () => {
    if (framework === 'playwright' && language === 'python') {
      return `from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("{{URL_BASE}}")
    page.fill("#username", "{{USUARIO_TEST}}")
    page.fill("#password", "{{PASSWORD_TEST}}")
    page.click("#login-btn")
    expect(page.locator(".dashboard")).to_be_visible()
    browser.close()`
    } else if (framework === 'playwright' && language === 'java') {
      return `import com.microsoft.playwright.*;

public class CasoPlaywright {
  public static void main(String[] args) {
    try (Playwright playwright = Playwright.create()) {
      Browser browser = playwright.chromium().launch();
      Page page = browser.newPage();
      page.navigate("{{URL_BASE}}");
      page.locator("#username").fill("{{USUARIO_TEST}}");
      page.locator("#password").fill("{{PASSWORD_TEST}}");
      page.locator("#login-btn").click();
      browser.close();
    }
  }
}`
    } else if (framework === 'playwright' && language === 'csharp') {
      return `using Microsoft.Playwright;

using var playwright = await Playwright.CreateAsync();
await using var browser = await playwright.Chromium.LaunchAsync();
var page = await browser.NewPageAsync();
await page.GotoAsync("{{URL_BASE}}");
await page.Locator("#username").FillAsync("{{USUARIO_TEST}}");
await page.Locator("#password").FillAsync("{{PASSWORD_TEST}}");
await page.Locator("#login-btn").ClickAsync();`
    } else if (framework === 'playwright') {
      return `const { test, expect } = require('@playwright/test');

test('caso de prueba', async ({ page }) => {
  // Navegar a la aplicacion
  await page.goto('{{URL_BASE}}');

  // Usar funcion reutilizable
  await login('{{USUARIO_TEST}}', '{{PASSWORD_TEST}}');

  // Verificar resultado
  await expect(page.locator('.dashboard')).toBeVisible();
});`
    } else if (framework === 'selenium' && language === 'java') {
      return `import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;

public class CasoSelenium {
  public static void main(String[] args) {
    WebDriver driver = new ChromeDriver();
    driver.get("{{URL_BASE}}");
    driver.findElement(By.id("username")).sendKeys("{{USUARIO_TEST}}");
    driver.findElement(By.id("password")).sendKeys("{{PASSWORD_TEST}}");
    driver.findElement(By.id("login-btn")).click();
    driver.quit();
  }
}`
    } else if (framework === 'selenium' && language === 'csharp') {
      return `using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

var driver = new ChromeDriver();
driver.Navigate().GoToUrl("{{URL_BASE}}");
driver.FindElement(By.Id("username")).SendKeys("{{USUARIO_TEST}}");
driver.FindElement(By.Id("password")).SendKeys("{{PASSWORD_TEST}}");
driver.FindElement(By.Id("login-btn")).Click();
driver.Quit();`
    } else if (framework === 'selenium' && language === 'ruby') {
      return `require 'selenium-webdriver'

driver = Selenium::WebDriver.for :chrome
driver.navigate.to "{{URL_BASE}}"
driver.find_element(id: 'username').send_keys "{{USUARIO_TEST}}"
driver.find_element(id: 'password').send_keys "{{PASSWORD_TEST}}"
driver.find_element(id: 'login-btn').click
driver.quit`
    } else if (framework === 'selenium') {
      return `from selenium import webdriver
from selenium.webdriver.common.by import By

def test_caso():
    driver = webdriver.Chrome()
    driver.get("{{URL_BASE}}")

    # Login
    driver.find_element(By.ID, "username").send_keys("{{USUARIO_TEST}}")
    driver.find_element(By.ID, "password").send_keys("{{PASSWORD_TEST}}")
    driver.find_element(By.ID, "login-btn").click()

    # Verificar
    assert "Dashboard" in driver.title
    driver.quit()`
    } else if (framework === 'cypress') {
      return `describe('Caso de prueba', () => {
  it('deberia hacer login', () => {
    cy.visit('{{URL_BASE}}');
    cy.get('#username').type('{{USUARIO_TEST}}');
    cy.get('#password').type('{{PASSWORD_TEST}}');
    cy.get('#login-btn').click();
    cy.get('.dashboard').should('be.visible');
  });
});`
    } else if (framework === 'puppeteer') {
      return `const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto('{{URL_BASE}}');
  await page.type('#username', '{{USUARIO_TEST}}');
  await page.type('#password', '{{PASSWORD_TEST}}');
  await page.click('#login-btn');

  await page.waitForSelector('.dashboard');

  await browser.close();
})();`
    }
    return '// Escribe tu script aqui'
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="d-flex align-items-center gap-2">
          <Badge bg="info" className="x-small">{t('common.scriptFramework', { framework: framework.toUpperCase() })}</Badge>
          <Badge bg="secondary" className="x-small">{t('common.scriptLanguage', { language: getLanguage() })}</Badge>
        </div>
        <Button
          variant="link"
          size="sm"
          className="p-0 text-primary shadow-none x-small"
          onClick={() => {
            confirmAction?.({
              title: t('common.scriptHelp'),
              message: t('common.scriptHelpMessage'),
              variant: 'info',
              confirmLabel: t('common.understood'),
              cancelLabel: null
            })
          }}
        >
          <Info size={14} /> {t('common.help')}
        </Button>
      </div>
      <div className="border rounded-3 overflow-hidden" style={{ height: '400px' }}>
        <Editor
          height="100%"
          language={getLanguage()}
          value={value || ''}
          onChange={(val) => onChange(val || '')}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: APP_EDITOR_FONT_SIZE,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            placeholder: getPlaceholder()
          }}
        />
      </div>
      <div className="mt-2">
        <small className="text-muted">
          {t('common.autocompleteTip')}
        </small>
      </div>
    </div>
  )
}
