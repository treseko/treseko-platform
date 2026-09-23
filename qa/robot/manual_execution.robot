*** Settings ***
Documentation     Bounded manual execution contract coverage. Uses only existing HTTP routes.
Library           RequestsLibrary
Library           OperatingSystem
Library           UUID
Suite Setup       Create QA Session
Suite Teardown    Delete QA Records If Created

*** Variables ***
${BASE_URL}        %{TRESEKO_BASE_URL=http://127.0.0.1:8000}
${TOKEN}           %{TRESEKO_EPHEMERAL_TOKEN=}
${PROJECT_ID}      %{TRESEKO_QA_PROJECT_ID=}
${BUILD_ID}        %{TRESEKO_QA_BUILD_ID=}
${CASE_ID}         %{TRESEKO_QA_CASE_ID=}
${EXECUTION_ID}    %{TRESEKO_QA_EXECUTION_ID=}

*** Keywords ***
Create QA Session
    Should Not Be Empty    ${TOKEN}    Ephemeral token is required; no secret is printed
    Create Session    treseko    ${BASE_URL}    headers=${{"Authorization": "Bearer ${TOKEN}", "Content-Type": "application/json"}}

Delete QA Records If Created
    [Documentation]    Existing cases/builds are never deleted. Cleanup is limited to IDs explicitly created by this suite.
    No Operation

Require Existing Case Context
    Should Not Be Empty    ${PROJECT_ID}
    Should Not Be Empty    ${BUILD_ID}
    Should Not Be Empty    ${CASE_ID}

*** Test Cases ***
Classic case can be selected and manual run started
    Require Existing Case Context
    ${payload}=    Create Dictionary    nombre=QA bounded manual run    entorno=QA    proyecto_id=${PROJECT_ID}    build_id=${BUILD_ID}    caso_ids=${[${CASE_ID}]}    origen=MANUAL
    ${response}=    POST On Session    treseko    /test-runs/    json=${payload}    expected_status=200
    ${run}=    Set Variable    ${response.json()}
    Should Be Equal    ${run}[origen]    MANUAL
    Should Be Equal As Strings    ${run}[build_id]    ${BUILD_ID}

Terminal status and snapshots/evidence persist
    Require Existing Case Context
    Should Not Be Empty    ${EXECUTION_ID}
    ${snapshot_response}=    GET On Session    treseko    /ejecuciones/${EXECUTION_ID}/snapshots/    expected_status=200
    ${snapshots}=    Set Variable    ${snapshot_response.json()}
    Should Not Be Empty    ${snapshots}
    ${snapshot_id}=    Set Variable    ${snapshots}[0][id]
    ${update}=    Create Dictionary    snapshots=${[${{id=${snapshot_id}, estado=PASO, comentarios=QA evidence persisted}}]}
    ${response}=    PATCH On Session    treseko    /ejecuciones/${EXECUTION_ID}/snapshots/    json=${update}    expected_status=200
    Should Be Equal    ${response.json()}[0][estado_paso]    PASO
    ${terminal}=    PATCH On Session    treseko    /ejecuciones/${EXECUTION_ID}/    params=${{"estado": "PASO", "comentarios": "QA terminal status persisted"}}    expected_status=200
    Should Be Equal    ${terminal.json()}[estado_resultado]    PASO

Unauthorized and invalid state are rejected
    Create Session    unauthenticated    ${BASE_URL}
    ${unauthorized}=    GET On Session    unauthenticated    /test-runs/${EXECUTION_ID}/ejecuciones/    expected_status=401
    Should Be Equal As Integers    ${unauthorized.status_code}    401
    Require Existing Case Context
    ${invalid}=    Create Dictionary    nombre=invalid state    entorno=QA    proyecto_id=${PROJECT_ID}    caso_ids=${[${CASE_ID}]}
    ${invalid_state}=    POST On Session    treseko    /test-runs/    json=${invalid}    expected_status=400
    Should Contain    ${invalid_state.text}    build activa
