var mongoose = require('mongoose');
var logger = require('./logger');
var dispatch = require('./dispatch');

var db = mongoose.createConnection(process.env.SERVICES_DB_URL || 
         'mongodb://localhost:27017/test/services');                 

var Service = db.model('Service', new mongoose.Schema ({
    name: String,
    versionMajor: Number,
    versionMinor: Number,
    versionPatch: Number,
    url: String,
    endpoints: [ new mongoose.Schema({
        type: String,
        url: String
    }) ],
    authorizedRoles: [ String ]
}));

function validateService(service) {
    var valid = true;

    valid = valid && service.name;
    valid = valid && service.versionMajor >= 0;
    valid = valid && service.versionMinor >= 0;
    valid = valid && service.versionPatch >= 0;
    valid = valid && service.url;

    valid = valid && Array.isArray(service.endpoints);
    if(valid) {
        service.endpoints.forEach(function(e) {
            valid = valid && e.type && e.url;
        });
    }
    
    valid = valid && Array.isArray(service.authorizedRoles);
    if(valid) {
        service.authorizedRoles.forEach(function(r) {
            valid = valid && r;
        });
    }
    
    return valid;
}

module.exports.register = function(service, callback) {    
    if(!validateService(service)) {
        callback(new Error("Invalid service"));
    }
    
    Service.findOne({ 
        name: service.name, 
        versionMajor: service.versionMajor, 
        versionMinor: service.versionMinor, 
        versionPatch: service.versionPatch 
    }, function(err, found) {
        if(found) {
            callback(new Error("Existing service"));
            return;
        }
        
        var dbService = new Service({
            name: service.name,
            versionMajor: service.versionMajor,
            versionMinor: service.versionMinor,
            versionPatch: service.versionPatch,
            url: service.url,
            endpoints: service.endpoints,
            authorizedRoles: service.authorizedRoles
        });
        
        dbService.save(function(err) {
            callback(err);
        });
    });
}

module.exports.unregister =
    function(name, versionMajor, versionMinor, versionPatch, callback) {
        logger.debug("Unregistering service: " + name);
        Service.findOne({ 
            name: name, 
            versionMajor: versionMajor, 
            versionMinor: versionMinor, 
            versionPatch: versionPatch 
        }, function(err, found) {                    
            if(!found || err) {
                logger.debug("Error while finding service: " + err);
                if(!found) {
                    callback(new Error("Service not found"));
                }
                return;
            }
            
            logger.debug("Removing service: " + found);
            
            found.remove(function(err2) {
                if(err2) {
                    logger.debug(err2);
                }
                logger.debug("Removed service: " + name);
                callback(null);
            });
        });
    }

module.exports.call = 
    function(name, versionMajor, versionMinor, versionPatch, data, callback) {    
        //logger.debug('Calling ' + name + ' version: ' + 
        //    versionMajor + '.' + versionMinor + '.' + versionPatch);
       
        Service.find({ 
            name: name, 
            versionMajor: versionMajor,
            versionMinor: { $gte: versionMinor },
            versionPatch: { $gte: versionPatch } 
        }).sort({ versionMinor: -1, versionPatch: -1 })
          .exec(function(err, services) {
            if(err) {
                callback(err);
                return;
            }
            
            if(services.length === 0) {
                callback(new Error("No service available"));
                return;
            }           
               
            //Recursive, consider this in production. This won't be a problem
            //once node.js and V8 support tail-call optimizations.
            function callNext(i) {                
                if(i === services.length) {
                    callback(new Error("No service available"));
                    return;
                } 
            
                logger.debug('Calling ' + services[i].name + ' version: ' + 
                    services[i].versionMajor + '.' + 
                    services[i].versionMinor + '.' + 
                    services[i].versionPatch);
            
                dispatch.serviceDispatch(services[i], data, 
                    function(err, response) {
                        if(err) {
                            logger.info("Failed call to: " + services[i]);                        
                            logger.error(err);
                            
                            callNext(i + 1);
                        } else {
                            logger.info("Succeeded call to: " + services[i]);
                        
                            callback(null, response);
                        }                        
                    }
                );
            }           
            
            callNext(0);
        });
    }


