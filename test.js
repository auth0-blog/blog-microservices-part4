var spawn = require('child_process').spawn;

var processes = [];
var pidMap = {};
var interval;

processes.push(spawn('mongod', ['--dbpath', 'db'], { detached: true }));
pidMap[processes[processes.length - 1].pid] = "mongod";
processes[processes.length - 1].unref();

setTimeout(function() {

processes.push(spawn('node', ['tickets.js']));
pidMap[processes[processes.length - 1].pid] = "tickets";

setTimeout(function() {

processes.push(spawn('node', ['tickets-random-fail.js']));
pidMap[processes[processes.length - 1].pid] = "tickets-random-fail";

setTimeout(function() {

processes.push(spawn('node', ['repliesFeed.js']));
pidMap[processes[processes.length - 1].pid] = "repliesFeed";

processes.forEach(function(p) {
    function printerFn(name) {
        return function(data) {
            process.stdout.write(name + " -> " + data.toString('utf-8'));
        }
    }

    var printer = printerFn(pidMap[p.pid]);

    p.stdout.on('data', printer);
    p.stderr.on('data', printer);
});

setTimeout(function() {

var registry = require('./registry');

registry.call('Ticket Add Comment', 1, 0, 1, { 
    "ticketId": "563be419992d3624477cccd9", 
    "message": "Test comment", 
    "user": "TestUser" 
}, function(err, response) {
    console.log('Ticket Add Comment: ' + JSON.stringify(response));
});

registry.call('Ticket Add Comment', 1, 0, 1, { 
    "ticketId": "563be419992d3624477cccd9", 
    "message": "Test comment 2", 
    "user": "TestUser" 
}, function(err, response) {
    console.log('Ticket Add Comment: ' + JSON.stringify(response));
});

setTimeout(function() {

registry.call('Ticket Latest Replies', 1, 0, 0, null, 
    function(err, response) {
        console.log('Ticket Latest Replies: ' + JSON.stringify(response));
    }
);

}, 2000);

interval = setInterval(function() {
    registry.call('Ticket Query', 1, 0, 0, null, 
        function(err, response) {
            console.log('Ticket Query: ' + JSON.stringify(response));
        }
    );
    
}, 1000);

}, 1000);

}, 1000);

}, 2000);

}, 5000);

function exitHandler() {
    console.log('Exiting...');

    clearInterval(interval);

    for(var i = processes.length - 1; i > 0; --i) {
        processes[i].kill();
    }

    setTimeout(function() {
        processes[0].on('exit', process.exit);
        processes[0].kill();
    }, 2000);
}

//process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
//process.on('uncaughtException', exitHandler);






