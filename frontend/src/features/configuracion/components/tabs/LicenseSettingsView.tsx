import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Spinner, Table } from 'react-bootstrap'
import { Crown, Download, KeyRound, Lock, ShieldCheck, Upload } from 'lucide-react'

export function LicenseSettingsView({ options }: { options: any }) {
  const { t, locale, loading, loadLicense, license, licenseStateMessage, limitRows, hasTrustWarning, trust, renderTrustKeyring, communityFeatures, premiumFeatures, enabledPremiumCount, disabledPremiumCount, licenseJson, canEditLicense, installing, installLicense, licenseFileName, loadLicenseFile, installDiagnostic, editionBadge, editionLabel, planLabel, stateBadge, stateLabel, updateChannelLabel, formatUsageValue, formatLimitValue, usageVariant, formatLicenseDate, daysUntil, featureIsActive } = options
  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 className="fw-bold text-secondary text-uppercase small m-0">{t('configuracion.licenseTitle')}</h5>
          <span className="small text-muted">{t('configuracion.licenseDescription')}</span>
        </div>
        <Button variant="outline-primary" className="fw-bold rounded-pill" onClick={loadLicense} disabled={loading}>
          {loading ? <Spinner size="sm" className="me-2" /> : <Download size={16} className="me-2" />}
          {t('configuracion.licenseRefresh')}
        </Button>
      </div>

      {loading ? (
        <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
          <div className="text-muted"><Spinner size="sm" className="me-2" /> {t('configuracion.licenseLoading')}</div>
        </Card>
      ) : (
        <>
          <Row className="g-3">
            <Col lg={4}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <div className="bg-primary bg-opacity-10 p-2 rounded-3"><ShieldCheck size={24} className="text-primary" /></div>
                    <div>
                      <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseCurrentEdition')}</div>
                      <h4 className="m-0">Treseko {license.edition === 'premium' ? t('configuracion.licensePremium') : t('configuracion.licenseCommunity')}</h4>
                      <div className="small text-muted fw-bold mt-1">{t('configuracion.licensePlan')}: {planLabel(license)}</div>
                    </div>
                  </div>
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Badge bg={editionBadge(license.edition)}>{editionLabel(license.edition)}</Badge>
                    <Badge bg="light" text="dark">{license.plan_custom ? t('configuracion.licenseCustomPlan') : planLabel(license)}</Badge>
                    {license.state !== license.edition && <Badge bg={stateBadge(license.state)}>{stateLabel(license.state, t)}</Badge>}
                    <Badge bg="light" text="dark">{updateChannelLabel(license.update_channel, t)}</Badge>
                  </div>
                  {licenseStateMessage && <Alert variant={license.state === 'active' ? 'success' : 'warning'} className="small mb-2">{licenseStateMessage}</Alert>}
                  {license.reason && license.reason !== licenseStateMessage && <Alert variant="light" className="border small mb-0">{license.reason}</Alert>}
                </Card.Body>
              </Card>
            </Col>
            <Col lg={8}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                      <div>
                        <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseUsageLimits')}</div>
                        <div className="small text-muted">
                        {t('configuracion.licenseUsageLimitsDescription')}
                        </div>
                      </div>
                    <Badge bg={license.edition === 'premium' ? 'success' : 'primary'}>
                      {license.edition === 'premium' ? t('configuracion.licensePremiumActive') : t('configuracion.licenseCommunityLocal')}
                    </Badge>
                  </div>
                  <Table size="sm" responsive className="align-middle small mb-0">
                    <thead>
                      <tr>
                        <th>{t('configuracion.licenseLimit')}</th>
                        <th style={{ minWidth: 220 }}>{t('configuracion.licenseCurrentUsage')}</th>
                        <th className="text-end">{t('configuracion.licenseCurrent')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {limitRows.map(row => (
                        <tr key={row.key}>
                          <td>
                            <span className="fw-bold">{row.label}</span>
                            {row.note && <div className="text-muted">{row.note}</div>}
                          </td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <ProgressBar
                                now={row.usage?.percent || 0}
                                variant={usageVariant(row.usage?.percent || 0)}
                                className="flex-grow-1"
                                style={{ height: 8, minWidth: 110 }}
                                aria-label={t('configuracion.licenseUsageAria', { label: row.label })}
                              />
                              <span className="small fw-bold text-nowrap">
                                {(row.usage?.percent || 0).toFixed(0)}%
                              </span>
                            </div>
                            <div className="x-small text-muted">
                              {formatUsageValue(row.key, row.usage?.used, locale)} {t('configuracion.licenseUsed')}
                            </div>
                          </td>
                          <td className="text-end fw-bold">{formatLimitValue(row.key, row.currentValue, locale, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="border-0 shadow-sm rounded-4 bg-white mt-3">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h6 className="fw-bold m-0">{t('configuracion.licensePeriodVerification')}</h6>
                  <div className="small text-muted">
                    {t('configuracion.licensePeriodDescription')}
                  </div>
                </div>
                <Badge bg={license.online_status === 'verified' ? 'success' : license.edition === 'premium' ? 'warning' : 'primary'}>
                    {license.online_status === 'verified' ? t('configuracion.licensePremiumVerified') : license.edition === 'premium' ? t('configuracion.licensePremiumLocalValidation') : t('configuracion.licenseCommunity')}
                </Badge>
              </div>
              {license.edition === 'premium' && license.online_status !== 'verified' && (
                <Alert variant="warning" className="small mb-3">
                  {license.online_reason || t('configuracion.licenseOnlineLocalOnly')}
                </Alert>
              )}
              <Row className="g-3">
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseValidUntil')}</div>
                    <div className="fw-bold">{formatLicenseDate(license.valid_until || license.license?.expires_at, t, locale)}</div>
                    {daysUntil(license.valid_until || license.license?.expires_at) !== null && (
                      <div className="small text-muted">
                        {t('configuracion.licenseDaysRemaining', { count: Math.max(daysUntil(license.valid_until || license.license?.expires_at) || 0, 0) })}
                      </div>
                    )}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseActivated')}</div>
                    <div className="fw-bold">{formatLicenseDate(license.activated_at, t, locale)}</div>
                    <div className="small text-muted">{t('configuracion.licenseFirstAssociation')}</div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseLastCheck')}</div>
                    <div className="fw-bold">{formatLicenseDate(license.last_check_at, t, locale)}</div>
                    <div className="small text-muted">{t('configuracion.licenseLastSignedResponse')}</div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseNextCheck')}</div>
                    <div className="fw-bold">{formatLicenseDate(license.next_check_at, t, locale)}</div>
                    {license.verification_interval_days && <div className="small text-muted">{t('configuracion.licenseInterval', { count: license.verification_interval_days })}</div>}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseOfflineGraceUntil')}</div>
                    <div className="fw-bold">{formatLicenseDate(license.grace_until, t, locale)}</div>
                    {license.grace_period_days && <div className="small text-muted">{t('configuracion.licenseConfiguredGrace', { count: license.grace_period_days })}</div>}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">{t('configuracion.licenseIssued')}</div>
                    <div className="fw-bold">{formatLicenseDate(license.issued_at || license.license?.issued_at, t, locale)}</div>
                    <div className="small text-muted">{t('configuracion.licenseSignedFileDate')}</div>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          <Card className="border-0 shadow-sm rounded-4 bg-white mt-3">
            <Card.Body>
              <div className="d-flex align-items-start gap-2 mb-3">
                <KeyRound size={20} className="text-primary mt-1" />
                <div>
                  <h6 className="fw-bold m-0">{t('configuracion.licenseTrustAndSignatures')}</h6>
                  <div className="small text-muted">
                    {t('configuracion.licenseTrustDescription')}
                  </div>
                </div>
              </div>
              {hasTrustWarning && (
                <Alert variant="warning" className="small">
                  {t('configuracion.licenseTrustWarning')}
                </Alert>
              )}
              <Row className="g-3">
                {renderTrustKeyring(t('configuracion.licensePremiumLicenses'), trust.license_keyring)}
                {renderTrustKeyring(t('configuracion.licensePremiumServer'), trust.server_response_keyring)}
                {renderTrustKeyring(t('configuracion.licenseSignedUpdates'), trust.update_keyring)}
              </Row>
            </Card.Body>
          </Card>

          <Row className="g-3 mt-1">
            <Col lg={6}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <ShieldCheck size={18} className="text-primary" />
                    <h6 className="fw-bold m-0">{t('configuracion.licenseCommunityEnabled')}</h6>
                    <Badge bg="primary">{communityFeatures.length}</Badge>
                  </div>
                  <div className="small text-muted mb-2">
                    {t('configuracion.licenseCommunityDescription')}
                  </div>
                  <Table size="sm" responsive className="align-middle small mb-0">
                    <tbody>
                      {communityFeatures.map(feature => (
                        <tr key={feature.id}>
                          <td className="fw-bold">{feature.label}</td>
                        <td className="text-end"><Badge bg={featureIsActive(feature) ? 'success' : 'secondary'}>{featureIsActive(feature) ? t('configuracion.licenseIncluded') : t('configuracion.licenseBlocked')}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <Crown size={18} className="text-warning" />
                    <h6 className="fw-bold m-0">{t('configuracion.licensePremiumByEntitlement')}</h6>
                    <Badge bg={license.edition === 'premium' && disabledPremiumCount === 0 ? 'success' : 'warning'} text={license.edition === 'premium' && disabledPremiumCount === 0 ? undefined : 'dark'}>
                      {enabledPremiumCount}/{premiumFeatures.length}
                    </Badge>
                  </div>
                  <Alert variant={license.edition === 'premium' ? 'info' : 'light'} className="border small mb-2">
                    {license.edition === 'premium'
                      ? t('configuracion.licenseEntitlementPartial')
                      : t('configuracion.licenseEntitlementRequired')}
                  </Alert>
                  <Table size="sm" responsive className="align-middle small mb-0">
                    <tbody>
                      {premiumFeatures.map(feature => (
                        <tr key={feature.id}>
                          <td>
                            <span className="fw-bold">{feature.label}</span>
                            {!featureIsActive(feature) && <span className="text-muted ms-2"><Lock size={12} /> {t('configuracion.licenseEntitlementNotIncluded')}</span>}
                          </td>
                          <td className="text-end">
                            <Badge bg={featureIsActive(feature) ? 'success' : 'light'} text={featureIsActive(feature) ? undefined : 'dark'}>
                              {featureIsActive(feature) ? t('configuracion.licenseActive') : license.edition === 'premium' ? t('configuracion.licenseNotIncluded') : t('configuracion.licenseRequiresPremium')}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="border-0 shadow-sm rounded-4 bg-white mt-3">
            <Card.Body>
              <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                <div>
                  <h6 className="fw-bold m-0">{t('configuracion.licenseInstallPremium')}</h6>
                  <div className="small text-muted">{t('configuracion.licenseInstallDescription')}</div>
                </div>
                <Button variant={licenseJson.trim() ? 'primary' : 'outline-primary'} className="fw-bold rounded-pill" disabled={!canEditLicense || installing || !licenseJson.trim()} onClick={installLicense}>
                  {installing ? <Spinner size="sm" className="me-2" /> : <Upload size={16} className="me-2" />}
                  {t('configuracion.licenseInstallPremium')}
                </Button>
              </div>
              {!canEditLicense && <Alert variant="light" className="border small">{t('configuracion.licenseEditPermission')}</Alert>}
              <div className="border rounded-3 bg-light p-3 mb-3">
                <Form.Label className="small fw-bold mb-1">{t('configuracion.licenseFile')}</Form.Label>
                <Form.Control
                  type="file"
                  accept=".treseko,.json,application/json"
                  disabled={!canEditLicense || installing}
                  onChange={(event) => {
                    const input = event.currentTarget as HTMLInputElement
                    const file = input.files?.[0]
                    void loadLicenseFile(file)
                    input.value = ''
                  }}
                />
                <div className="x-small text-muted mt-2">
                  {licenseFileName ? t('configuracion.licenseFileLoadedShort', { name: licenseFileName }) : t('configuracion.licenseFileFormat')}
                </div>
              </div>
              {installDiagnostic && (
                <Alert variant="danger" className="small mt-3 mb-0">
                  {t('configuracion.licenseDiagnosticError')}
                  <details className="mt-2">
                    <summary className="fw-bold" role="button">{t('configuracion.licenseTechnicalDiagnostic')}</summary>
                    <pre className="bg-light border rounded-3 p-2 mt-2 mb-0 text-wrap">{installDiagnostic}</pre>
                  </details>
                </Alert>
              )}
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  )
}
