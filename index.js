var ws = require('ws');
var http = require('http');

var webserve = http.createServer(function(req, res) {
	res.writeHead(200, {"Content-type": "text/plain"});
	res.write("Future home of Turbo-Spork!");
	res.end();
}).listen(process.env.PORT || 5000);

var sockserve = new ws.Server({server: webserve});
sockserve.on('connection', function(conn) {
	console.log(conn);
	conn.on('message', function(message) {
		console.log(message);
	});
});
