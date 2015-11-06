var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var http = require('http');
var url = require('url');
var Q = require('q');
var mongo = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var registry = require('./registry');
var logger = require('./logger');

var serviceName = 'Tickets Service';

var mongoUrl = process.env.MONGO_URL || 
    'mongodb://localhost:27017/test/services';

// Express and middlewares
var app = express();
app.use(
    //Log requests
    morgan(':method :url :status :response-time ms - :res[content-length]', { 
        stream: logger.stream 
    })
);

app.use(bodyParser.json());

var db;
mongo.connect(mongoUrl, null, function(err, db_) {
    if(err) {
        logger.error(err);
    } else {
        db = db_;
    }
});

app.use(function(req, res, next) {    
    if(!db) {
        //Database not connected
        mongo.connect(mongoUrl, null, function(err, db_) {
            if(err) {
                logger.error(err);
                res.sendStatus(500);                
            } else {
                db = db_;
                next();
            }
        });
    } else {
        next();
    }    
});

function randomFail(req, res, next) {
    var min = 1;
    var max = 2;
    var rand = Math.floor(Math.random() * (max - min + 1)) + min;
    
    if(rand === 2) {
        res.sendStatus(500);        
    } else {
        next();
    }
}

// Actual query
app.get('/tickets', randomFail, function(req, res) {
    var collection = db.collection('tickets');
    collection.find().toArray(function(err, result) {
        if(err) {
            logger.error(err);
            res.sendStatus(500);
            return;
        } 
        res.json(result);
    });   
});

var commentSubscribers = {};

function notifySubscribers(data) {
    var collection = db.collection('tickets');
    var oid = new ObjectID(data.ticketId);
    collection.findOne({ '_id': oid }, { title: 1 }, function(err, ticket) {
        if(err) {
            logger.error(err);
            return;
        }       
        
        data.title = ticket.title;
        var jsonData = JSON.stringify(data);
        
        logger.debug(data);
        
        for(var subscriber in commentSubscribers) {
            if(commentSubscribers.hasOwnProperty(subscriber)) {
                console.log('EVENT: sending new reply to subscriber: ' + 
                    subscriber);
                dest = url.parse(subscriber);
            
                var req = http.request({
                    hostname: dest.hostname,
                    port: dest.port,
                    path: dest.path,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': jsonData.length
                    }                    
                });
                
                req.on('error', function(err) {
                    logger.error(err);
                });
                
                req.write(jsonData);
                req.end();
            }
        }
    });
}

// Add message to ticket
app.post('/tickets/addComment', function(req, res) {
    var collection = db.collection('tickets');
    var oid = new ObjectID(req.body.ticketId);
    collection.update({ '_id': oid }, { 
        $push: { 
            replies: { 
                user: req.body.user, 
                message: req.body.message 
            } 
        } 
    }, function(err) {
        if(err) {
            logger.error(err);
            res.sendStatus(500);
        } else {
            res.sendStatus(200);
            
            notifySubscribers({
                ticketId: req.body.ticketId,
                user: req.body.user,
                message: req.body.message
            });
        }
    });
});

// Ticket modification listeners
app.post('/tickets/subscribeToComments', function(req, res) {
    commentSubscribers[req.body.url] = true;
    res.sendStatus(200);
});

app.post('/tickets/unsubscribeToComments', function(req, res) {
    delete commentSubscribers[req.body.url];
    res.sendStatus(200);
});

function exitHandler() {
    var unregister = Q.denodeify(registry.unregister);
    var promises = [];
    
    promises.push(unregister('Ticket Query', 1, 0, 1));
    promises.push(unregister('Ticket Add Comment', 1, 0, 1));
    promises.push(unregister('Ticket Subscribe', 1, 0, 1));
    promises.push(unregister('Ticket Unsubscribe', 1, 0, 1));
    
    Q.all(promises).fin(function() {
        process.exit();
    });   
}

process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
process.on('uncaughtException', exitHandler);

// Standalone server setup
var port = process.env.PORT || 3005;
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
            name: 'Ticket Query',
            versionMajor: 1,
            versionMinor: 0,
            versionPatch: 1,
            url: '/tickets',
            endpoints: [ {
                type: 'http-get',
                url: 'http://127.0.0.1:' + port + '/tickets'
            } ],
            authorizedRoles: ['tickets-query']
        }, registerCallback);
        
        registry.register({
            name: 'Ticket Add Comment',
            versionMajor: 1,
            versionMinor: 0,
            versionPatch: 1,
            url: '/tickets/addComment',
            endpoints: [ {
                type: 'http-post',
                url: 'http://127.0.0.1:' + port + '/tickets/addComment'
            } ],
            authorizedRoles: ['tickets-update']
        }, registerCallback);
        
        registry.register({
            name: 'Ticket Subscribe',
            versionMajor: 1,
            versionMinor: 0,
            versionPatch: 1,
            url: '/tickets/subscribeToComments',
            endpoints: [ {
                type: 'http-post',
                url: 'http://127.0.0.1:' + port + '/tickets/subscribeToComments'
            } ],
            authorizedRoles: ['tickets-query']
        }, registerCallback);
        
        registry.register({
            name: 'Ticket Unsubscribe',
            versionMajor: 1,
            versionMinor: 0,
            versionPatch: 1,
            url: '/tickets/unsubscribeToComments',
            endpoints: [ {
                type: 'http-post',
                url: 'http://127.0.0.1:' + port + '/tickets/unsubscribeToComments'
            } ],
            authorizedRoles: ['tickets-query']
        }, registerCallback);
    }
});


