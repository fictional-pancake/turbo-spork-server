var ws = require('ws');
var http = require('http');
var pg = require('pg');
var bcrypt = require('bcrypt-nodejs');

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

var password = {
	hash: function(password, callback) {
		bcrypt.hash(password, null, null, callback);
	},
	verify: function(password, hash, callback) {
		bcrypt.compare(password, hash, callback);
	}
};

var webserve = http.createServer(function(req, res) {
	console.log(req.url);
	res.writeHead(200, {"Content-type": "text/plain"});
	res.write("Future home of Turbo-Spork!");
	res.end();
}).listen(process.env.PORT || 5000);

var logins = {};
var games = {};

var commands = {
	auth: {
		data: true,
		handler: function(conn, d) {
			conn.send("error:You're already authenticated");
		}
	},
	join: {
		data: true,
		handler: function(conn, d) {
			var gd;
			for(var id in games) {
				var ind = games[id].users.indexOf(d.user);
				if(ind > -1) {
					games[id].users.splice(ind,1);
					for(var i = 0; i < games[id].users.length; i++) {
						var cconn = logins[games[id].users[i]].conn;
						cconn.send("leave:"+logins[d.user].name);
					}
				}
			}
			if(d.data in games) {
				var gd = games[d.data];
				if("data" in gd) {
					conn.send("error:Game already started.");
					return;
				}
				for(var i = 0; i < gd.users.length; i++) {
					var id = gd.users[i];
					var cconn = logins[id].conn;
					var cname = logins[id].name;
					cconn.send("join:"+logins[d.user].name);
				}
			}
			else {
				gd = {users: []};
				games[d.data] = gd;
			}
			gd.users.push(d.user);
			for(var i = 0; i < gd.users.length; i++) {
				var id = gd.users[i];
				conn.send("join:"+logins[id].name);
			}
		}
	}
};

var handleMessage = function(user, message) {
	console.log(user+": "+message);
	var conn = logins[user].conn;
	var cmd;
	var data = null;
	var ind = message.indexOf(":");
	if(ind > -1) {
		cmd = message.substring(0, ind);
		data = message.substring(ind+1);
	}
	else {
		cmd = message;
	}
	var info = commands[cmd];
	if(info) {
		if(info.data === true && data === null) {
			conn.send("error:That command requires additional data");
		}
		else if(info.data === false && data !== null) {
			conn.send("error:That command doesn't require data");
		}
		else {
			info.handler(conn, {
				data: data,
				user: user
			});
		}
	}
	else {
		conn.send("error:Invalid command");
	}
};

var sockserve = new ws.Server({server: webserve});
sockserve.on('connection', function(conn) {
	var func = function(message) {
		console.log(message);
		var s = message.split(":");
		if(s.length == 2 && s[0] == "auth") {
			var id = s[1];
			if(id in logins) {
				logins[id].conn.send("error:You logged in from another location");
				logins[id].conn.close();
			}
			logins[id] = {conn: conn, name: id};
			conn.removeListener("message", func);
			conn.on("message", handleMessage.bind(conn, id));
		}
		else {
			conn.send("error:Invalid auth message");
			conn.close();
		}
	};
	conn.on('message', func);
});
