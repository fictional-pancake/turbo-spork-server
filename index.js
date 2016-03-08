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

var handleWeb = function(req, res, POST) {
	if (req.url == "/") {
		res.writeHead(200, {"Content-type": "text/plain"});
		res.write("Future home of Turbo-Spork!");
	} else if (req.url == "/signup") {
		res.writeHead(200, {"Content-type": "text/html"});
		res.write("<!DOCTYPE html><html><head><title>Sign up</title></head><body>");
		res.write("<form method=\"POST\" action=\"signupaction\">Username: <input type\"text\" name=\"username\"/><br>");
		res.write("Password: <input type=\"password\" name=\"password\"/><br>");
		res.write("<input type=\"submit\" value=\"Submit\"/></form>");
		res.write("</body></html>");
	} else if (req.url == "/signupaction") {
		if (POST.username.indexOf(":") == -1 && POST.password.indexOf(":") == -1) {
			db.query("SELECT EXISTS(SELECT 1 FROM users WHERE name=$1)",  [POST.username], function(err, result) {
				if (err) {
					console.error("query is scrublord and didn't work", err);
					res.write("query is scrublord");
				}
				else if (result.rows[0].exists) {
					console.log(result);
					console.log("User already exists");
					res.write("User already exists noob");
				}
				else {
					console.log("User does not already exist");
					password.hash(POST.password, function(err, hash) {
						db.query("INSERT INTO users (name, passhash) VALUES ($1, $2)", [POST.username, hash], function(err, result) {
							if (err) {
								console.error("query is scrublord and didn't work", err);
								res.write("query is scrublord");
							} else {
								console.log("Created new user with username " + POST.username);
								res.write("Created new user with username " + POST.username);
							}
						});
					});
				}
			});
		}
	} else {
		res.writeHead(404, {"Content-type": "text/plain"});
		res.write("404 rekt");
	}
	res.end();
};

var webserve = http.createServer(function(req, res) {
	var POST = {};
	var hwr = handleWeb.bind(this, req, res, POST);
	console.log(req.url);
	if (req.method == 'POST') {
		console.log("it's POST");
		req.on('data', function(data) {
			console.log("DATA");
			data = data.toString();
			data = data.split('&');
			for (var i = 0; i < data.length; i++) {
				var _data = data[i].split("=");
				POST[_data[0]] = _data[1];
			}
			console.log(POST);
		});
		req.on('end', hwr);
	}
	else {
		hwr();
	}
}).listen(process.env.PORT || 5000);

var removeUserFromGames = function(user) {
	for(var id in games) {
		var ind = games[id].users.indexOf(user);
		if(ind > -1) {
			games[id].users.splice(ind,1);
			for(var i = 0; i < games[id].users.length; i++) {
				var cconn = logins[games[id].users[i]].conn;
				cconn.send("leave:"+logins[user].name);
			}
		}
	}
};

var GAMERULES = {
	NODES_PER_USER_AT_START: 3,
	UNCLAIMED_NODES_AT_START: 1,
	MIN_DISTANCE_BETWEEN_NODES: 8,
	FIELD_SIZE: 100,
	ATTEMPTS_TO_PLACE_NODES: 5
};

var applyDefault = function(shown, def) {
	if(shown !== undefined) {
		return shown;
	}
	else {
		return def;
	}
};

var applyDefaultToMap = function(target, source, name, def) {
	target[name] = applyDefault(source[name], def);
}

var createNode = function(defaults, nodes) {
	var tr = {d: 0};
	for(var i = 0; i < GAMERULES.ATTEMPTS_TO_PLACE_NODES; i++) {
		var tc = {};
		applyDefaultToMap(tc, defaults, "x", Math.floor(Math.random()*(GAMERULES.FIELD_SIZE-GAMERULES.MIN_DISTANCE_BETWEEN_NODES*2))+GAMERULES.MIN_DISTANCE_BETWEEN_NODES);
		applyDefaultToMap(tc, defaults, "y", Math.floor(Math.random()*(GAMERULES.FIELD_SIZE-GAMERULES.MIN_DISTANCE_BETWEEN_NODES*2))+GAMERULES.MIN_DISTANCE_BETWEEN_NODES);
		applyDefaultToMap(tc, defaults, "owner", -1);
		applyDefaultToMap(tc, defaults, "generationTime", 1000);
		applyDefaultToMap(tc, defaults, "unitCap", 100);
		if(nodes && nodes.length > 0) {
			for(var x = 0; x < nodes.length; x++) {
				var cn = nodes[x];
				var dsq = Math.pow(cn.x-tc.x,2)+Math.pow(cn.y-tc.y,2);
				if(dsq >= Math.pow(GAMERULES.MIN_DISTANCE_BETWEEN_NODES, 2)) {
					return tc;
				}
				if(dsq > tr.d) {
					tr = {tr: tc, d: dsq};
				}
			}
		}
		else {
			return tc;
		}
	}
	return tr.tr;
};

var startGame = function(name) {
	var nodes = [];
	for(var i = 0; i < games[name].users.length; i++) {
		for(var x = 0; x < GAMERULES.NODES_PER_USER_AT_START; x++) {
			nodes.push(createNode({
				owner: i,
			}, nodes));
		}
	}
	for(var x = 0; x < GAMERULES.UNCLAIMED_NODES_AT_START; x++) {
		nodes.push(createNode({}, nodes));
	}
	games[name].data = {nodes: nodes};
	for(var i = 0; i < games[name].users.length; i++) {
		var cconn = logins[games[name].users[i]].conn;
		cconn.send("gamestart:"+JSON.stringify(games[name].data));
	}
};

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
			removeUserFromGames(d.user);
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
	},
	gamestart: {
		data: false,
		handler: function(conn, d) {
			for(var id in games) {
				var gd = games[id];
				var ind = gd.users.indexOf(d.user);
				if(ind>-1) {
					if(ind == 0) {
						startGame(id);
						return;
					}
					else {
						conn.send("error:You aren't the game leader.");
						return;
					}
				}
			}
			conn.send("error:You aren't in a room.");
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

var lastTick = -1;

var tick = function() {
	var time = new Date().getTime();
	for(var id in games) {
		var gd = games[id];
		if("data" in gd) {
			if("unitgroups" in gd.data) {
				var groups = gd.data.unitgroups;
				for(var i = 0; i < groups.length; i++) {
					var group = groups[i];
					if(group.start+group.duration >= time) {
						// reached destination
						var node = gd.data.nodes[group.dest];
						if(!(group.owner in node.units)) {
							node.units[group.owner] = 0;
						}
						node.units[group.owner] += group.size;
					}
				}
			}
			for(var i = 0; i < gd.data.nodes.length; i++) {
				var node = gd.data.nodes[i];
				if(!("units" in node)) {
					node.units = {};
				}
				if(node.owner != -1) {
					if(!(node.owner in node.units)) {
						node.units[node.owner] = 0;
					}
					// generate new units
					node.units[node.owner] = Math.min(node.units[node.owner] + (time-lastTick)*node.generationTime, node.unitCap);
				}
				// ensure owner is correct
				var rightfulOwner = -1;
				for(var u in node.units) {
					if(node.units > 0) {
						if(rightfulOwner == -1) {
							rightfulOwner = u;
						}
						else {
							// multiple owner's units, node owner unknown
							rightfulOwner = -1;
						}
					}
				}
				if(rightfulOwner != -1) {
					if(node.owner != rightfulOwner) {
						node.owner = rightfulOwner;
						for(var j = 0; j < gd.users.length; j++) {
							var cconn = logins[gd.users[j]].conn;
							cconn.send("update:"+i+",owner,"+node.owner);
						}
					}
				}
			}
		}
	}
	lastTick = time;
};

setInterval(tick, 0);

var handleLostConnection = function(user) {
	removeUserFromGames(user);
	delete logins[user];
};

var sockserve = new ws.Server({server: webserve});
sockserve.on('connection', function(conn) {
	var func = function(message) {
		// this is called the first time the server receives a message
		// it should be an auth message
		console.log(message);
		var s = message.split(":");
		if(s.length == 3 && s[0] == "auth") {
			// yes, it is
			db.query("SELECT * FROM users WHERE name=$1", [s[1]], function(err, result) {
				if(err) {
					console.error("QUERY IS SCRUBLORD", err);
					conn.send("error:query is scrublord");
					conn.close();
				}
				else if(result.rows.length == 1) {
					password.verify(s[2], result.rows[0].passhash, function(x, data) {
						if(!x && data) {
							var id = s[1];
							console.log(s[1]+" ("+id+") logged in!");
							if(id in logins) {
								logins[id].conn.send("error:You logged in from another location");
								logins[id].conn.close();
							}
							logins[id] = {conn: conn, name: id};
							conn.send("join:"+s[1]);
							conn.removeListener("message", func);
							conn.on("message", handleMessage.bind(conn, id));
							conn.on("close", handleLostConnection.bind(conn, id));
						}
						else {
							conn.send("error:Incorrect password");
							conn.close();
						}
					});
				}
				else {
					conn.send("error:Incorrect login");
				}
			});
		}
		else {
			conn.send("error:Invalid auth message");
			conn.close();
		}
	};
	conn.on('message', func);
});
