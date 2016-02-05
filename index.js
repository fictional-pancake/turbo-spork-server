var ws = require('ws');
var http = require('http');
var pg = require('pg');

if(!process.env.DATABASE_URL) {
	console.log("DATABASE_URL missing.  Please correct this.");
	process.exit();
}

var db = new pg.Client(process.env.DATABASE_URL);
db.connect(function(err) {
	if(err) {
		console.log("Error connecting to database");
		console.log(err);
		process.exit();
	}
});

var webserve = http.createServer(function(req, res) {
	res.writeHead(200, {"Content-type": "text/plain"});
	res.write("Future home of Turbo-Spork!");
	res.end();
}).listen(process.env.PORT || 5000);

var handleMessage = function(user, message) {
	console.log(user+": "+message);
};

var logins = {};

var sockserve = new ws.Server({server: webserve});
sockserve.on('connection', function(conn) {
	var func = function(message) {
		console.log(message);
		var s = message.split(":");
		if(s.length == 2 && s[0] == "auth") {
			logins[s[1]] = {conn: conn};
			conn.removeListener("message", func);
			conn.on("message", handleMessage.bind(conn, s[1]));
		}
		else {
			conn.send("Invalid auth message.");
			conn.close();
		}
	};
	conn.on('message', func);
});
