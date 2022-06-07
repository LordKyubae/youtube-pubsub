'use strict';

const xml2js = require('xml2js');

const regexp = /^(text\/xml|application\/([\w!#$%&*`\-.^~]+\+)?xml)$/i;

function xmlbodyparser(req, res, notifier) {
  var data = '';

  var parser = new xml2js.Parser({
    async: false,
    explicitArray: true,
    normalize: true,
    normalizeTags: true,
    trim: true,
  });

  function responseHandler(err, xml) {
    if (err) {
      err.status = 400;
      return notifier._onRequest(req, res);
    }

    req.body = xml || req.body;
    req.rawBody = data;
    notifier._onRequest(req, res);
  }

  if (req._body) return notifier._onRequest(req, res);

  req.body = req.body || {};

  if (!hasBody(req) || !regexp.test(mime(req))) return notifier._onRequest(req, res);

  req._body = true;

  req.setEncoding('utf-8');
  req.on('data', chunk => {
    data += chunk;
  });

  parser.saxParser.onend = () => {
    if (req.complete && req.rawBody === undefined) {
      return responseHandler(null);
    }
  };

  req.on('end', () => {
    if (data.trim().length === 0) {
      return notifier._onRequest(req, res);
    }

    parser.parseString(data, responseHandler);
  });
}

function hasBody(req) {
  var encoding = 'transfer-encoding' in req.headers;
  var length = 'content-length' in req.headers && req.headers['content-length'] !== '0';
  return encoding || length;
}

function mime(req) {
  var str = req.headers['content-type'] || '';
  return str.split(';')[0];
}

module.exports = xmlbodyparser;
