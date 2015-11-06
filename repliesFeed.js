var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var logger = require('./logger');
var registry = require('./registry');
var Q = require('q');

var latestReplies = [];

var port = process.env.PORT || 3006;

// Express and middlewares
var app = express();
app.use(
    //Log requests
    morgan(':method :url :status :response-time ms - :res[content-length]', { 
        stream: logger.stream 
    })
);

app.use(bodyParser.json());

app.post('/replyEvent', function(req, res) {
    //TODO: validate req.body data
    
    logger.debug(req.body);
    
    latestReplies.push(req.body);
    if(latestReplies.length > 10) {
        latestReplies.splice(0, latestReplies.length - 10);
    }

    res.sendStatus(200);
});

app.get('/latestReplies', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(latestReplies));
    res.end();
});

var eventUrl = 'http://127.0.0.1:' + port + '/replyEvent';

function subscribe() {
    var data = JSON.stringify({
        url: eventUrl
    });
    
    registry.call('Ticket Subscribe', 1, 0, 1, data, function(err, response) {
        if(err) {
            logger.error(err);
        }
    });
}

subscribe();

//Renew subscription every minute in case the event generator is restarted.
//Other systems might require reduced latency.
setInterval(subscribe, 60 * 1000);

function exitHandler() {
    var unregister = Q.denodeify(registry.unregister);
    var registryCall = Q.denodeify(registry.call);
    var promises = [];
    
    promises.push(unregister('Ticket Latest Replies', 1, 0, 0));
    promises.push(registryCall('Ticket Unsubscribe', 1, 0, 0, 
        JSON.stringify(eventUrl)));
    
    Q.all(promises).fin(function() {
        process.exit();
    });   
}

process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
process.on('uncaughtException', exitHandler);

// Standalone server setup
http.createServer(app).listen(port, function (err) {
    if (err) {
        logger.error(err);
        process.exit();
    } else {  
        logger.info('Listening on http://localhost:' + port);

        function registerCallback(err) {
            if(err) {
                logger.error(err);
                process.exit();
            }
        }

        registry.register({
            name: 'Ticket Latest Replies',
            versionMajor: 1,
            versionMinor: 0,
            versionPatch: 0,
            url: '/latestReplies',
            endpoints: [ {
                type: 'http-get',
                url: 'http://127.0.0.1:' + port + '/latestReplies'
            } ],
            authorizedRoles: ['tickets-query']
        }, registerCallback);        
    }
});


