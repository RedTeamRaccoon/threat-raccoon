import express from 'express';

const config = (app) => {
    // Route-scoped larger limit ONLY for the LLM proxy (design-doc attachments:
    // base64 images / text). It is registered BEFORE the default parser so it
    // parses first and sets req._body; the default express.json() then skips an
    // already-parsed request. Every other endpoint keeps the 100kb default, so
    // the request-body DoS surface is not widened globally.
    app.use('/api/llm/complete', express.json({ limit: '25mb' }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
};

export default {
    config
};
