'use strict';

const EventEmitter = require('events');
const server = require('./server');
const { post } = require('axios');
const urllib = require('url');
const qs = require('querystring');
const crypto = require('crypto');
const xmlbodyparser = require('./xmlParser');

const base_topic = 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=';

class YouTubePubsub extends EventEmitter {

  constructor(options = {}) {
    if (!options.callback) throw new Error('You need to provide the callback URL.');
    super();

    this.callback = options.callback;

    this.hubUrl = options.hubUrl || 'https://pubsubhubbub.appspot.com/';

    this.secret = options.secret;

    this.port = options.port || 3000;

    this.path = options.path || '/';

    this.server = null;

    this._recieved = [];
  }

  setup() {
    if (this.server) throw new Error('The Server has been already setup.');
    this.server = server(this);
    this.server.listen(this.port);
  }

  listener() {
    return (req, res) => {
      xmlbodyparser(req, res, this);
    };
  }

  subscribe(channels) {
    if (
      !channels ||
      (typeof channels !== 'string' && !Array.isArray(channels))
    ) {
      throw new Error(
        'You need to provide a channel id or an array of channel ids.',
      );
    }
    if (typeof channels === 'string') {
      this._makeRequest(channels, 'subscribe');
    } else {
      channels.forEach(channel => this._makeRequest(channel, 'subscribe'));
    }
  }

  unsubscribe(channels) {
    if (
      !channels ||
      (typeof channels !== 'string' && !Array.isArray(channels))
    ) {
      throw new Error(
        'You need to provide a channel id or an array of channel ids.',
      );
    }
    if (typeof channels === 'string') {
      this._makeRequest(channels, 'unsubscribe');
    } else {
      channels.forEach(channel => this._makeRequest(channel, 'unsubscribe'));
    }
  }

  _makeRequest(channel_id, type) {
    const topic = base_topic + channel_id;
    const data = {
      'hub.callback': this.callback,
      'hub.mode': type,
      'hub.topic': topic,
    };

    if (this.secret) data['hub.secret'] = this.secret;

    post(this.hubUrl, qs.stringify(data), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  _onRequest(req, res) {
    if (req.method === 'GET') {
      this._onGetRequest(req, res);
    } else if (req.method === 'POST') {
      this._onPostRequest(req, res);
    } else {
      return res.sendStatus(403);
    }
  }

  _onGetRequest(req, res) {
    let params = urllib.parse(req.url, true, true).query;

    if (!params['hub.topic'] || !params['hub.mode']) {
      return res
        .status(400)
        .set('Content-Type', 'text/plain')
        .end('Bad Request');
    }

    res
      .status(200)
      .set('Content-Type', 'text/plain')
      .end(params['hub.challenge']);

    const data = {
      type: params['hub.mode'],
      channel: params['hub.topic'].replace(base_topic, ''),
    };

    if (params['hub.lease_seconds']) data.lease_seconds = params['hub.lease_seconds'];

    this.emit(params['hub.mode'], data);
  }

  _onPostRequest(req, res) {
    let signatureParts, algo, signature, hmac;

    if (this.secret && !req.headers['x-hub-signature']) {
      return res.sendStatus(403);
    }

    if (req.body.feed['at:deleted-entry']) return res.sendStatus(200);

    let body = req.body.feed.entry;

    if (!body) {
      return res
        .status(400)
        .set('Content-Type', 'text/plain')
        .end('Bad Request');
    }
    body = body[0];
    let { rawBody } = req;

    if (this.secret) {
      signatureParts = req.headers['x-hub-signature'].split('=');
      algo = (signatureParts.shift() || '').toLowerCase();
      signature = (signatureParts.pop() || '').toLowerCase();

      try {
        hmac = crypto.createHmac(algo, this.secret);
      } catch (E) {
        return res.sendStatus(403);
      }

      hmac.update(rawBody);

      if (hmac.digest('hex').toLowerCase() !== signature) {
        return res.sendStatus(200);
      }
    }

    let vidId = body['yt:videoid'][0];
    let publishTIme = new Date(body.published[0]);
    let updateTime = new Date(body.updated[0]);

    if (this._recieved.includes(vidId)) {
      this._recieved.splice(this._recieved.indexOf(vidId), 1);
      return res.sendStatus(200);
    }

    if (updateTime - publishTIme < 300000) {
      this._recieved.push(vidId);
    }

    let data = {
      video: {
        id: vidId,
        title: body.title[0],
        link: body.link[0].$.href,
      },
      channel: {
        id: body['yt:channelid'][0],
        name: body.author[0].name[0],
        link: body.author[0].uri[0],
      },
      published: publishTIme,
      updated: updateTime,
    };

    this.emit('notified', data);

    res.sendStatus(200);
  }
}

module.exports = YouTubePubsub;
