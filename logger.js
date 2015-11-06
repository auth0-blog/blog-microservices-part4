var winston = require('winston');

// Logging
winston.emitErrs = true;
var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({
            timestamp: true,
            level: 'debug',
            handleExceptions: false,
            json: false,
            colorize: true
        })
    ],
    exitOnError: false
});

logger.stream = {
    write: function(message, encoding){
        logger.debug(message.replace(/\n$/, ''));
    }
};

module.exports = logger;


