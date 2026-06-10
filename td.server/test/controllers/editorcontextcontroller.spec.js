import { expect } from 'chai';
import sinon from 'sinon';

import { getMockRequest, getMockResponse } from '../mocks/express.mocks.js';
import editorContext from '../../src/helpers/editorContext.helper.js';
import editorContextController from '../../src/controllers/editorcontextcontroller.js';

describe('controllers/editorcontextcontroller.js', () => {
    let mockRequest;
    let mockResponse;

    beforeEach(() => {
        mockRequest = getMockRequest();
        mockResponse = getMockResponse();
    });

    describe('update', () => {
        it('stores the reported context and responds with the stored value', () => {
            const stored = { page: 'diagram', diagramId: 1, updatedAt: '2026-06-10T00:00:00.000Z' };
            sinon.stub(editorContext, 'set').returns(stored);
            mockRequest.body = { page: 'diagram', diagramId: 1 };

            editorContextController.update(mockRequest, mockResponse);

            expect(editorContext.set).to.have.been.calledOnceWith(mockRequest.body);
            expect(mockResponse.status).to.have.been.calledWith(200);
            expect(mockResponse.json).to.have.been.calledWith({ status: 200, data: stored });
        });

        it('treats a missing body as a clear', () => {
            sinon.stub(editorContext, 'set').returns(null);
            mockRequest.body = undefined;

            editorContextController.update(mockRequest, mockResponse);

            expect(editorContext.set).to.have.been.calledOnceWith(null);
            expect(mockResponse.json).to.have.been.calledWith({ status: 200, data: null });
        });

        it('responds with a server error when storing fails', () => {
            sinon.stub(editorContext, 'set').throws(new Error('boom'));
            mockRequest.body = { page: 'diagram' };

            editorContextController.update(mockRequest, mockResponse);

            expect(mockResponse.status).to.have.been.calledWith(500);
        });
    });
});
