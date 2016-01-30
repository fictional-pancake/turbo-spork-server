var ws = require('ws');

var server = new ws.Server({port: process.env.PORT || 5000});
server.on('connection', function(conn) {
	console.log(conn);
	conn.on('message', function(message) {
		console.log(message);
	});
});
