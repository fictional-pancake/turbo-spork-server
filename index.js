var PROTOCOL_VERSION = 1;

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
		res.end();
	} else if (req.url == "/signup") {
		res.writeHead(200, {"Content-type": "text/html"});
		res.write("<!DOCTYPE html><html><head><title>Sign up</title></head><body>");
		res.write("<form method=\"POST\" action=\"signupaction\">Username: <input type\"text\" name=\"username\"/><br>");
		res.write("Password: <input type=\"password\" name=\"password\"/><br>");
		res.write("<input type=\"submit\" value=\"Submit\"/></form>");
		res.write("</body></html>");
		res.end();
	} else if (req.url == "/signupaction") {
		if (POST.username && POST.password && POST.username.indexOf(":") == -1 && POST.password.indexOf(":") == -1) {
			db.query("SELECT EXISTS(SELECT 1 FROM users WHERE name=$1)",  [POST.username], function(err, result) {
				if (err) {
					console.error("query is scrublord and didn't work", err);
					res.write("query is scrublord");
					res.end();
				}
				else if (result.rows[0].exists) {
					console.log(result);
					console.log("User already exists");
					res.write("User already exists noob");
					res.end();
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
							res.end();
						});
					});
				}
			});
		}
		else {
			res.write("Invalid request.  You must have a username and password that don't contain \":\".");
			res.end();
		}
	} else {
		res.writeHead(404, {"Content-type": "text/plain"});
		res.write("404 rekt");
		res.end();
	}
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

var handleWin = function(gd, owner) {
	broadcast("win:"+logins[gd.users[owner]].name, gd);
	delete gd.data;
};

var removeUserFromGames = function(user, died) {
	for(var id in games) {
		var ind = games[id].users.indexOf(user);
		if(ind > -1) {
			if(!died) {
				logins[user].conn.send("leave:"+logins[user].name);
			}
			games[id].users.splice(ind,1);
			var win = games[id].users.length == 1 && ("data" in games[id]);
			broadcast("leave:"+logins[user].name, games[id]);
			if(win) {
				handleWin(games[id], 0);
			}
		}
	}
};

var GAMERULES = {
	NODES_PER_USER_AT_START: 3,
	UNCLAIMED_NODES_AT_START: 5,
	MIN_DISTANCE_BETWEEN_NODES: 8,
	FIELD_SIZE: 100,
	ATTEMPTS_TO_PLACE_NODES: 5,
	CHANCE_TO_KILL: 0.0001
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
};

var distance = function() {
	if(arguments.length == 2) {
		return distance(arguments[0].x, arguments[0].y, arguments[1].x, arguments[1].y);
	}
	else if(arguments.length == 4) {
		return Math.sqrt(Math.pow(arguments[1]-arguments[3], 2)+Math.pow(arguments[0]-arguments[2], 2));
	}
	else {
		return NaN;
	}
};

var createNode = function(defaults, nodes) {
	var tr = {d: 0};
	for(var i = 0; i < GAMERULES.ATTEMPTS_TO_PLACE_NODES; i++) {
		var tc = {};
		applyDefaultToMap(tc, defaults, "x", Math.floor(Math.random()*(GAMERULES.FIELD_SIZE-GAMERULES.MIN_DISTANCE_BETWEEN_NODES*2))+GAMERULES.MIN_DISTANCE_BETWEEN_NODES);
		applyDefaultToMap(tc, defaults, "y", Math.floor(Math.random()*(GAMERULES.FIELD_SIZE-GAMERULES.MIN_DISTANCE_BETWEEN_NODES*2))+GAMERULES.MIN_DISTANCE_BETWEEN_NODES);
		applyDefaultToMap(tc, defaults, "owner", -1);
		applyDefaultToMap(tc, defaults, "generationTime", 1000);
		applyDefaultToMap(tc, defaults, "unitCap", 50);
		applyDefaultToMap(tc, defaults, "unitSpeed", .01);
		if(nodes && nodes.length > 0) {
			var mindsq = Infinity;
			for(var x = 0; x < nodes.length; x++) {
				var cn = nodes[x];
				var dsq = Math.pow(cn.x-tc.x,2)+Math.pow(cn.y-tc.y,2);
				if(dsq < mindsq) {
					mindsq = dsq;
				}
			}
			if(mindsq >= Math.pow(GAMERULES.MIN_DISTANCE_BETWEEN_NODES, 2)) {
				return tc;
			}
			if(mindsq > tr.d) {
				tr = {tr: tc, d: mindsq};
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
	broadcast("gamestart:"+JSON.stringify(games[name].data), games[name]);
};

var logins = {};
var games = {};

var commands = {
	auth: {
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
				broadcast("join:"+logins[d.user].name, gd);
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
						if(gd.users.length > 1) {
							startGame(id);
						}
						else {
							conn.send("error:You need at least two players");
						}
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
	},
	attack: {
		data: true,
		handler: function(conn, d) {
			var s = d.data.split(",");
			if(s.length == 2) {
				var src = parseInt(s[0]);
				var dst = parseInt(s[1]);
				for(var id in games) {
					var gd = games[id];
					var ind = gd.users.indexOf(d.user);
					if(ind>-1) {
						if("data" in gd) {
							if(src >= 0 && src < gd.data.nodes.length && dst >= 0 && dst < gd.data.nodes.length) {
								if(ind == gd.data.nodes[src].owner) {
									var size = Math.floor(gd.data.nodes[src].units[ind]);
									gd.data.nodes[src].units[ind] -= size;
									var group = {
										source: src,
										dest: dst,
										start: new Date().getTime(),
										duration: Math.round(distance(gd.data.nodes[src], gd.data.nodes[dst])/gd.data.nodes[src].unitSpeed),
										size: size,
										owner: parseInt(gd.data.nodes[src].owner)
									};
									broadcast("send:"+JSON.stringify(group), gd);
									if(!("unitgroups" in gd.data)) {
										gd.data.unitgroups = [];
									}
									gd.data.unitgroups.push(group);
								}
								else {
									conn.send("error:You don't own that node.");
								}
							}
							else {
								conn.send("error:That node doesn't exist.");
							}
						}
						else {
							conn.send("error:Game not started");
						}
						return;
					}
				}
				conn.send("error:You aren't in a room.");
			}
			else {
				conn.send("error:Invalid attack");
			}
		}
	},
	keepalive: {
		data: false,
		handler: function() {}
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

var broadcast = function(msg, gd) {
	for(var j = 0; j < gd.users.length; j++) {
		var cconn = logins[gd.users[j]].conn;
		cconn.send(msg);
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
					if(group.start+group.duration <= time) {
						// reached destination
						var node = gd.data.nodes[group.dest];
						if(!(group.owner in node.units)) {
							node.units[group.owner] = 0;
						}
						node.units[group.owner] += group.size;
						groups.splice(i, 1);
						i--;
					}
				}
			}
			var winner = -1;
			for(var i = 0; i < gd.data.nodes.length; i++) {
				var node = gd.data.nodes[i];
				if(!("units" in node)) {
					node.units = {};
				}
				if(node.owner != -1) {
					if(winner == -1) {
						// make sure there's no battle going on
						var numOwners = 0;
						for(var u in node.units) {
							if(node.units[u] > 0) numOwners++;
						}
						winner = node.owner;
					}
					else if(winner != node.owner) winner = -2;
					if(!(node.owner in node.units)) {
						node.units[node.owner] = 0;
					}
					// generate new units
					var generationTime = node.generationTime;
					for(var u in node.units) {
						if(u != node.owner && node.units[u] > 0) {
							generationTime *= 2;
							break;
						}
					}
					node.units[node.owner] = Math.max(node.units[node.owner], Math.min(node.units[node.owner] + (time-lastTick)/generationTime, node.unitCap));
					for(var k in node.units) {
						if(node.units[k] > 0) {
							for(var k2 in node.units) {
								if(k != k2 && node.units[k2] > 0) {
									if(Math.random() / node.units[k] < GAMERULES.CHANCE_TO_KILL * (time-lastTick)) {
										node.units[k2]--;
										broadcast("death:"+i+","+k2, gd);
									}
									break;
								}
							}
						}
					}
				}
				// ensure owner is correct
				var rightfulOwner = -1;
				for(var u in node.units) {
					if(node.units[u] > 0) {
						if(rightfulOwner == -1) {
							rightfulOwner = u;
						}
						else {
							// multiple owner's units, node owner unknown
							rightfulOwner = -2;
						}
					}
				}
				if(rightfulOwner >= 0) {
					if(node.owner != rightfulOwner) {
						node.owner = rightfulOwner;
						broadcast("update:"+i+",owner,"+node.owner, gd);
					}
				}
			}
			if(winner >= 0) {
				// make sure they really win
				var reallyWin = true;
				for(var j = 0; j < gd.data.unitgroups.length; j++) {
					var group = gd.data.unitgroups[j];
					if(group.owner != winner) {
						reallyWin = false;
					}
				}
				if(reallyWin) {
					handleWin(gd, winner);
				}
			}
		}
	}
	lastTick = time;
};

setInterval(tick, 0);

var handleLostConnection = function(user) {
	removeUserFromGames(user, true);
	console.log(logins[user].name+" left");
	delete logins[user];
};

var sockserve = new ws.Server({server: webserve});
sockserve.on('connection', function(conn) {
	var func = function(message) {
		// this is called the first time the server receives a message
		// it should be an auth message
		conn.removeListener("message", func);
		console.log(message);
		var s = message.split(":");
		if(s.length == 4 && s[0] == "auth") {
			// yes, it is
			if(s[3] == PROTOCOL_VERSION) {
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
									var tconn = logins[id].conn;
									tconn.send("error:You logged in from another location");
									handleLostConnection(id);
									tconn.close();
								}
								logins[id] = {conn: conn, name: id};
								conn.send("join:"+s[1]);
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
						try {
							conn.send("error:Incorrect login");
							conn.close();
						} catch(e) {
							console.error(e);
						}
					}
				});
			}
			else {
				if(s[3] > PROTOCOL_VERSION) {
					conn.send("error:Outdated server!");
				}
				else {
					conn.send("error:Your client is outdated.  Update to play!");
				}
			}
		}
		else {
			conn.send("error:Invalid auth message");
			conn.close();
		}
	};
	conn.on('message', func);
});
