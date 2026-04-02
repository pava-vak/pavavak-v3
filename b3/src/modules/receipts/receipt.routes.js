function registerReceiptRoutes(app) {
  app.post('/api/v3/messages/:messageId/delivered', async (request) => ({
    success: false,
    messageId: request.params.messageId,
    module: 'receipts',
    status: 'not_implemented'
  }));

  app.post('/api/v3/messages/:messageId/read', async (request) => ({
    success: false,
    messageId: request.params.messageId,
    module: 'receipts',
    status: 'not_implemented'
  }));
}

module.exports = { registerReceiptRoutes };
