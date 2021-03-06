var PORT = process.env.PORT || 9002;
var async = require('async');
var extend = require('extend');
var express = require('express');
var app = express();

var Datastore = require('nedb');
var db = {};
db.data = new Datastore({ filename: __dirname + '/data/data', autoload: true });
db.workers = new Datastore({ filename: __dirname + '/data/workers', autoload: true });

var Runner = require('./run.js');

app.use(express.json());

app.use('/static', express.static(__dirname + '/public'));

app.post('/save', function(req, res) {
  db.data.findOne({testId: req.body.testId}, function(err, doc){
    if (doc) {
      db.data.update({testId: req.body.testId}, extend(true, doc, req.body))
    }
  });
  res.send(200);
});

app.post('/end', function(req, res) {
  // Kill req.body.workerId
  res.send(200);
  var workerId = req.body.workerId;
  console.log('Got end request for', workerId);
  var id = WORKER_IDS[workerId];
  clearTimeout(WORKER_TIMEOUTS[workerId]);
  if (id) {
    Runner.kill(id);
    var cb = WORKER_CBS[workerId];
    if (cb) {
      delete WORKER_CBS[workerId];
      cb()
    };
  } else {
    console.log('Got end request without valid workerId', req.body.workerId);
  }

});

app.get('/dump', function(req, res) {
  db.data.find({}, function(err, data){
    res.send(data);
  });
});

app.get('/browsers', function(req, res) {
  Runner.getBrowsers(function(err, browsers){
    res.send(browsers);
  });
});

app.listen(PORT);


// Start tests

// Browsers to test
var BROWSERS = JSON.parse(require('fs').readFileSync('browsers.json').toString());

var URL = 'http://peerjs.com:9002'

// Map of our workerIds to BrowserStack ids
var WORKER_IDS = {};
// Callbacks to be called when workers end
var WORKER_CBS = {};
// Timeouts for killing workers
var WORKER_TIMEOUTS = {};

function startMirror() {
  async.eachSeries(BROWSERS, function(browser, eachCb){
    var clientBrowser = browser.client;
    var hostBrowser = browser.host;
    db.data.findOne({'client.setting': clientBrowser, 'host.setting': hostBrowser}, function(err, data) {
      if (data) {
        return eachCb();
      } else {
        Runner.killAll(function(){

          // This test id
          var testId = guid();

          var clientId = guid();
          var clientSetting = generateWorkerSettings(clientBrowser, testId, 'client', clientId);
          var hostId = guid();
          var hostSetting = generateWorkerSettings(hostBrowser, testId, 'host', hostId);

          console.log('====== Starting new test:', browserString(clientBrowser), 'connecting to', browserString(hostBrowser));
          db.data.insert({
            testId: testId,
            client: {setting: clientBrowser},
            host: {setting: hostBrowser}
          });

          async.parallel([
            function(pCb){
              Runner.start(hostSetting, pCb);
            },
            function(pCb){
              setTimeout(function(){
                Runner.start(clientSetting, pCb);
              }, 1000);
            }
          ], function(err, results) {
            if (err) {
              eachCb('Failed to start clients ' + err.toString());
            }
            console.log('Clients started');
            WORKER_IDS[clientId] = results[1].id;
            WORKER_IDS[hostId] = results[0].id;
            async.parallel({
              client: function(endCb) {
                WORKER_CBS[clientId] = endCb;
                WORKER_TIMEOUTS[clientId] = setTimeout(timeout(clientId), 60000);
              },
              host: function(endCb){
                WORKER_CBS[hostId] = endCb;
                WORKER_TIMEOUTS[hostId] = setTimeout(timeout(hostId), 60000);
              }
            }, function(){
              // Test is done!
              console.log('========== Finished test:', browserString(clientBrowser), 'connecting to', browserString(hostBrowser));
              eachCb();
            });
          });
        });
      }
    });
  }, function(err){
    if (err) {
      console.log('TESTS FAILED TO RUN:', err);
    } else {
      console.log('TESTS DONE');
    }
  });
}

function timeout(workerId) {
  return function() {
    var id = WORKER_IDS[workerId];
    var cb = WORKER_CBS[workerId];
    if (id) {
      Runner.kill(id);
    }
    if (cb) {
      console.log('Server timeout, killing', workerId);
      cb();
      delete WORKER_CBS[workerId];
    }
    delete WORKER_TIMEOUTS[workerId];
  };
}

function generateWorkerSettings(browser, testId, role, workerId) {
  setting = extend(true, {}, browser);
  setting.url = URL + '/static/test.html?TEST_ID=' + testId + '&ROLE=' + role + '&WORKER_ID=' + workerId + '&PEERJS_VERSION=' + browser.peerJSVersion;
  return setting;
}

function browserString(browser) {
  return browser.os + ' ' + browser.browser + ' ' + browser.browser_version + ' peer.js v' + browser.peerJSVersion;
}


function guid () {
  function s4 () {
    return Math.floor((1 + Math.random()) * 0x10000)
               .toString(16)
               .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
         s4() + '-' + s4() + s4() + s4();
}

startMirror();