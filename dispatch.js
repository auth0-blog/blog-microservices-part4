var http = require('http');
var url = require('url');
var Q = require('q');
var amqp = require('amqp');
var _ = require('underscore');
var logger = require('./logger');

/*
 * Internal HTTP request, auth data is passed in headers.
 */
function httpSend(endpoint, data, deferred, isGet) {
    var parsedEndpoint = url.parse(endpoint);
    
    if(isGet && data) {
        logger('Warning: discarding data in HTTP GET (should it be POST?)');
    }    
    
    if(!data) {
        data = '';
    }
    
    if(typeof data !== 'string') {
        data = JSON.stringify(data);
    }

    var options = {
        hostname: parsedEndpoint.hostname,
        port: parsedEndpoint.port,
        path: parsedEndpoint.path,
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? {} : {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    var req = http.request(options, function(res) {    
        var resData = "";
        res.on('data', function (chunk) {
            resData += chunk;
        });
        res.on('end', function() {
            if(res.statusCode !== 200) {
                deferred.reject({
                    data: data, 
                    endpoint: endpoint, 
                    message: 'Status code !== 200: ' + res.statusCode
                });
                return;
            }
        
            try {
                try {
                    var json = JSON.parse(resData);
                    deferred.resolve(json);
                } catch(e) {
                    deferred.resolve(resData);
                }
            } catch(err) {
                deferred.reject({
                    data: data, 
                    endpoint: endpoint, 
                    message: 'Invalid data format: ' + err.toString()
                });
            }
        });
    });

    req.on('error', function(e) {
        deferred.reject({
            data: data, 
            endpoint: endpoint, 
            message: e.toString()
        });
    });

    if(!isGet && data) {
        req.write(data);
    }
    req.end();
}

/* 
 * Internal HTTP request
 */
function httpPromise(data, endpoint, isGet) {
    var result = Q.defer();   
    
    httpSend(endpoint, data, result, isGet);    
    
    return result.promise;
}

function amqpSend(endpoint, data, deferred) {
    amqpConn.queue('', {
        exclusive: true
    }, function(queue) {
        queue.bind('#');
        
        queue.subscribe({ ack: true, prefetchCount: 1 }, 
            function(message, headers, deliveryInfo, messageObject) {
                messageObject.acknowledge();
                
                try {
                    var json = JSON.parse(message);
                    deferred.resolve(json);
                } catch(err) {
                    deferred.reject({
                        data: data, 
                        endpoint: endpoint, 
                        message: 'Invalid data format: ' + err.toString()
                    });
                }               
            }
        );
        
        //Default exchange
        var exchange = amqpConn.exchange();
        //Send data
        exchange.publish(endpoint, data ? data : {}, {
            deliveryMode: 1, //non-persistent
            replyTo: queue.name,
            mandatory: true,
            immediate: true
        }, function(err) {
            if(err) {
                deferred.reject({
                    data: data, 
                    endpoint: endpoint, 
                    message: 'Could not publish message to the default ' + 
                             'AMQP exchange'
                });
            }
        });
    });
}

/* 
 * Internal AMQP request
 */
function amqpPromise(data, endpoint) {
    var result = Q.defer();   
    
    amqpSend(endpoint, data, result);
    
    return result.promise;
}

function serviceDispatch(service, data, callback) {
    // Fanout all requests to all related endpoints. 
    // Results are aggregated (more complex strategies are possible).
    var promises = [];
    service.endpoints.forEach(function(endpoint) {                               
        switch(endpoint.type) {
            case 'http-get':
            case 'http-post':
                promises.push(httpPromise(data, endpoint.url, 
                    endpoint.type === 'http-get'));
                break;
            case 'amqp':
                promises.push(amqpPromise(data, endpoint.url));
                break;
            default:
                logger.error('Unknown endpoint type: ' + endpoint.type);
        }            
    });
    
    //Aggregation strategy for multiple endpoints.
    Q.allSettled(promises).then(function(results) {  
        var responseData = {};
    
        var error = false;
        results.forEach(function(result) {
            if(result.state === 'fulfilled') {
                responseData = _.extend(responseData, result.value);
            } else {
                logger.error(result.reason.message);
                error = true;
            }
        });

        callback(error ? new Error('Incomplete response') : null, responseData);        
    });
}

module.exports.amqpPromise = amqpPromise;
module.exports.httpPromise = httpPromise;
module.exports.serviceDispatch = serviceDispatch;


