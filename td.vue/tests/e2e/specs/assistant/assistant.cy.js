// tests for the in-app AI assistant: the LLM backend is fully mocked
// (config flags come from the mock server, completions from cy.intercept),
// so no real provider is ever called

const openDemoDiagram = () => {
    cy.get('#local-login-btn').click();
    cy.get('a[href="#/demo/select"]').click();
    cy.get('[data-model-name="Demo Threat Model"]').click();
    cy.contains('.diagram-edit', 'Main Request Data Flow').click();
    cy.get('#graph-container').should('be.visible');
    cy.get('#graph-container .x6-graph-svg-stage')
        .children()
        .should('have.length.greaterThan', 0);
};

const openAssistantPanel = () => {
    cy.get('.td-assistant-toggle').click();
    cy.get('.td-assistant-panel').should('be.visible');
};

// builds the SSE body in the exact normalized format the proxy emits
// (data-only records separated by a blank line, type inside the payload)
const sseBody = (events) => events.map((evt) => `data: ${JSON.stringify(evt)}\n\n`).join('');

// stubs /api/config (the mock server response shape) with the given LLM overrides
const stubConfig = (overrides) => {
    cy.intercept('GET', '/api/config', {
        statusCode: 200,
        body: {
            status: 200,
            data: Object.assign({
                githubEnabled: true, bitbucketEnabled: false, gitlabEnabled: true,
                googleEnabled: false, localEnabled: true,
                allowedLocales: ['en'], defaultLocale: 'en',
                llmEnabled: true, llmAllowUserKey: false,
                llmDefaultProvider: 'anthropic', llmDefaultModel: 'mock-model',
                llmProviders: [
                    {
                        id: 'anthropic',
                        label: 'Anthropic Claude',
                        models: [{ id: 'mock-model', label: 'mock-model' }],
                        default: 'mock-model',
                    }
                ],
            }, overrides)
        }
    });
};

describe('assistant', () => {
    describe('with the AI assistant disabled', () => {
        beforeEach(() => {
            stubConfig({ llmEnabled: false });
            // reload so the config is re-fetched under the intercept
            cy.visit('/');
            openDemoDiagram();
        });

        it('does not show the assistant toggle', () => {
            cy.get('.td-assistant-toggle').should('not.exist');
        });
    });

    describe('with the AI assistant enabled', () => {
        beforeEach(() => {
            openDemoDiagram();
        });

        it('shows the assistant toggle on the diagram editor', () => {
            cy.get('.td-assistant-toggle').should('be.visible');
        });

        it('opens and closes the assistant panel', () => {
            openAssistantPanel();
            cy.contains('.td-assistant-panel', 'AI Assistant');
            cy.get('.td-assistant-panel button[title="Close assistant"]').click();
            cy.get('.td-assistant-panel').should('not.exist');
        });

        it('offers the provider and model reported by the server config', () => {
            openAssistantPanel();
            cy.get('.td-assistant-selectors select').first()
                .find('option').should('contain.text', 'Anthropic Claude');
            cy.get('.td-assistant-selectors select').last()
                .find('option').should('contain.text', 'mock-model');
        });

        it('enables the composer once a diagram is open and a prompt is typed', () => {
            openAssistantPanel();
            // a diagram is open, so the no-diagram hint is absent
            cy.contains('Open a diagram to start collaborating').should('not.exist');
            cy.contains('.td-assistant-composer button', 'Send').should('be.disabled');
            cy.get('#assistant-input').type('Model my system');
            cy.contains('.td-assistant-composer button', 'Send').should('be.enabled');
        });
    });

    describe('with no providers configured', () => {
        beforeEach(() => {
            stubConfig({ llmProviders: [], llmDefaultProvider: null, llmDefaultModel: null });
            cy.visit('/');
            openDemoDiagram();
            openAssistantPanel();
        });

        it('keeps send disabled even with a prompt', () => {
            cy.get('#assistant-input').type('Model my system');
            cy.contains('.td-assistant-composer button', 'Send').should('be.disabled');
        });
    });

    describe('agent loop against a scripted LLM stream', () => {
        beforeEach(() => {
            openDemoDiagram();
        });

        it('executes a streamed tool_use and the element appears on the canvas', () => {
            const toolUseTurn = sseBody([
                { type: 'message_start' },
                { type: 'text_delta', text: 'Adding a process to the diagram.' },
                { type: 'tool_use_start', index: 0, id: 'toolu_mock_1', name: 'addElement' },
                { type: 'tool_use_delta', index: 0, partial_json: '{"kind":"process",' },
                { type: 'tool_use_delta', index: 0, partial_json: '"name":"Mock API"}' },
                { type: 'message_delta', stop_reason: 'tool_use' },
                { type: 'message_stop' }
            ]);
            const finalTurn = sseBody([
                { type: 'message_start' },
                { type: 'text_delta', text: 'Done - I added the Mock API process.' },
                { type: 'message_delta', stop_reason: 'end_turn' },
                { type: 'message_stop' }
            ]);

            let llmCalls = 0;
            cy.intercept('POST', '/api/llm/complete', (req) => {
                llmCalls += 1;
                req.reply({
                    statusCode: 200,
                    headers: { 'content-type': 'text/event-stream' },
                    body: llmCalls === 1 ? toolUseTurn : finalTurn
                });
            }).as('llmComplete');

            openAssistantPanel();
            cy.get('#assistant-input').type('Add a process for the API');
            cy.contains('.td-assistant-composer button', 'Send').click();

            // first turn requests the addElement tool
            cy.wait('@llmComplete');
            // second turn carries the tool_result back to the model
            cy.wait('@llmComplete').its('request.body').should((body) => {
                const lastMessage = body.messages[body.messages.length - 1];
                const toolResult = lastMessage.content.find((block) => block.type === 'tool_result');
                expect(toolResult, 'tool_result posted back to the LLM').to.exist;
                expect(toolResult.tool_use_id).to.equal('toolu_mock_1');
                expect(toolResult.is_error).to.be.false;
            });

            // the element from the scripted tool_use is live on the X6 canvas
            cy.contains('#graph-container .x6-cell.x6-node tspan', 'Mock API').should('exist');

            // and the transcript shows the assistant's turns
            cy.contains('.td-assistant-panel', 'I added the Mock API process');
        });
    });
});
