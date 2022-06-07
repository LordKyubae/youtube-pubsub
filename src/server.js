'use strict';

const express = require('express');

const app = express();

function server(notifier) {
  app.use(notifier.path, notifier.listener());

  return app;
}

module.exports = server;
