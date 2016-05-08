var PROTOCOL_VERSION = 12;
var COMPATIBLE_VERSIONS = [11];

var ws = require('ws');
var http = require('http');
var pg = require('pg');
var bcrypt = require('bcrypt-nodejs');
var fs = require('fs');
var multiparty = require('multiparty');
var mime = require('mime');

if(!process.env.DATABASE_URL) {
	console.error("DATABASE_URL missing.  Please correct this.");
	process.exit();
}

var db = new pg.Client(process.env.DATABASE_URL);
db.connect(function(err) {
	if(err) {
		console.error("Error connecting to database");
		console.error(err);
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

var replacements = {
	HEAD1: "<!DOCTYPE html><head>",
	HEAD2: "</head><body><h1 style=\"text-align: center\">Turbo-Spork</h1>",
	FOOTER: "</body></html>"
};

var handleWeb = function(req, res, POST) {
	if (req.url == "/signupaction") {
		if (!POST.username || !POST.password) {
			res.write("You must have a username and password");
			res.end();
		}
		else if(POST.username.indexOf(":") > -1 || POST.password.indexOf(":") > -1) {
			res.write("Your username and password cannot contain \":\".");
			res.end();
		}
		else if(POST.username.indexOf("guest") == 0) {
			res.write("Usernames starting with \"guest\" are reserved for guests.");
			res.end();
		}
		else {
			db.query("SELECT EXISTS(SELECT 1 FROM users WHERE name=$1)",  [POST.username], function(err, result) {
				if (err) {
					res.write("query is scrublord");
					res.end();
				}
				else if (result.rows[0].exists) {
					res.write("User already exists noob");
					res.end();
				}
				else {
					password.hash(POST.password, function(err, hash) {
						db.query("INSERT INTO users (name, passhash) VALUES ($1, $2)", [POST.username, hash], function(err, result) {
							if (err) {
								console.error("query is scrublord and didn't work", err);
								res.write("query is scrublord");
							} else {
								res.write("Created new user with username " + POST.username);
							}
							res.end();
						});
					});
				}
			});
		}
	} else if(req.url == "/version") {
	       res.writeHead(200, {"Content-type": "text/plain"});
	       res.write(""+PROTOCOL_VERSION);
	       res.end();
	} else {
		var url = req.url;
		if(url == "/") {
			url = "/home";
		}
		fs.readFile(__dirname+"/pages"+url+".html", function(err, data) {
			if(err) {
				fs.readFile(__dirname+"/pages"+url, function(err, data) {
					if(err) {
						res.writeHead(404, {"Content-type": "text/plain"});
						res.write("404 rekt");
						res.end();
					}
					else {
						res.writeHead(200, {"Content-type": mime.lookup(url)});
						res.write(data);
						res.end();
					}
				});
			}
			else {
				data = ""+data;
				for(var k in replacements) {
					data = data.replace("${"+k+"}", replacements[k]);
				}
				for(var k in GAMERULES) {
					data = data.replace("$["+k+"]", GAMERULES[k]);
					data = data.replace("$["+k+"/]", GAMERULES[k]/1000);
				}
				res.writeHead(200, {"Content-type": "text/html"});
				res.write(data);
				res.end();
			}
		});
	}
};

var webserve = http.createServer(function(req, res) {
	var POST = {};
	var hwr = handleWeb.bind(this, req, res, POST);
	console.log(req.url);
	if (req.method == 'POST') {
		var form = new multiparty.Form();
		form.parse(req, function(err, fields) {
			for(var key in fields) {
				POST[key] = fields[key][0];
			}
			hwr();
		});
	}
	else {
		hwr();
	}
}).listen(process.env.PORT || 5000);

var broadcast = function(msg, gd, minVersion) {
	var recipients = gd.users;
	if("spectators" in gd) recipients = recipients.concat(gd.spectators);
	for(var j = 0; j < recipients.length; j++) {
		var userdata = logins[recipients[j]];
		if(!minVersion || userdata.version >= minVersion) {
			var cconn = userdata.conn;
			cconn.send(msg);
		}
	}
};

var getRoom = function(user) {
	for(var id in games) {
		var gd = games[id];
		if(gd.users.indexOf(user) > -1 || ("spectators" in gd && gd.spectators.indexOf(user) > -1)) {
			return id;
		}
	}
};

var handleWin = function(id, owner) {
	var gd = games[id];
	broadcast("win:"+logins[gd.users[owner]].name, gd);
	delete gd.data;
	if(id.indexOf("matchme") == 0) {
		while(gd.users.length > 0) {
			removeUserFromGames(gd.users[0]);
		}
	}
};

var adjustForRemoved = function(gd, ind) {
	var tr = ind;
	if("data" in gd) {
		var removed = gd.data.removed.slice().sort();
		for(var i = 0; i < removed.length; i++) {
			if(removed[i] <= tr) {
				tr++;
			}
		}
	}
	return tr;
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
				handleWin(id, 0);
			}
			else if("data" in games[id]) {
				games[id].data.removed.push(adjustForRemoved(games[id], ind));
			}
		}
		else if("spectators" in games[id]) {
			var si = games[id].spectators.indexOf(user);
			if(si > -1) {
				if(!died) {
					logins[user].conn.send("leave:"+logins[user].name);
				}
				games[id].spectators.splice(si, 1);
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
	CHANCE_TO_KILL: 0.0001,
	TRANSFORM_TIME: 2000,
	MATCH_WAIT_TIME: 10000,
	GAME_START_DELAY: 2125
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
		applyDefaultToMap(tc, defaults, "generationTime", 1500);
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
	games[name].data = {nodes: nodes, removed: []};
	broadcast("gameinfo:"+JSON.stringify(games[name].data), games[name]);
	setTimeout(function() {
		// make sure that game still exists before starting it
		if (name in games) {
			broadcast("gamestart", games[name]);
			games[name].data.gameStarted = true;
		}
	}, GAMERULES.GAME_START_DELAY);
};

var lastGroupID = 0;
var nextGroupID = function() {
	return ++lastGroupID;
};

var logins = {};
var games = {};

var commands = {
	auth: {
		handler: function(d) {
			d.conn.send("error:You're already authenticated");
		}
	},
	join: {
		data: true,
		handler: function(d) {
			if(d.data == "matchme") {
				var found = false;
				for(var id in games) {
					if(id.indexOf("matchme") == 0 && !("data" in games[id])) {
						found = true;
						d.data = id;
					}
				}
				if(!found) {
					var i = 1;
					while(true) {
						var name = "matchme"+i;
						if(!(name in games && "data" in games[name])) {
							d.data = name;
							break;
						}
						i++;
					}
				}
			}
			var gd;
			removeUserFromGames(d.user);
			if(d.data in games) {
				gd = games[d.data];
				if("data" in gd) {
					d.conn.send("error:Game already started.");
					return;
				}
				broadcast("join:"+logins[d.user].name, gd);
			}
			else {
				gd = {users: [], created: new Date().getTime()};
				games[d.data] = gd;
			}
			gd.users.push(d.user);
			for(var i = 0; i < gd.users.length; i++) {
				var id = gd.users[i];
				d.conn.send("join:"+logins[id].name);
			}
		}
	},
	spectate: {
		data: true,
		handler: function(d) {
			if(d.data in games) {
				removeUserFromGames(d.user);
				var gd = games[d.data];
				if(!("spectators" in gd)) {
					gd.spectators = [];
				}
				gd.spectators.push(d.user);
				for(var i = 0; i < gd.users.length; i++) {
					d.conn.send("join:"+logins[gd.users[i]].name);
				}
				if("data" in gd) {
					d.conn.send("gamestart:"+JSON.stringify({nodes: gd.data.nodes}));
					sync(gd);
				}
			}
			else {
				d.conn.send("error:Nobody's there.  You can't spectate them.");
			}
		}
	},
	leave: {
		data: false,
		handler: function(d) {
			removeUserFromGames(d.user);
		}
	},
	gamestart: {
		data: false,
		handler: function(d) {
			for(var id in games) {
				var gd = games[id];
				var ind = gd.users.indexOf(d.user);
				if(ind>-1) {
					if(ind == 0 && id.indexOf("matchme") != 0) {
						if("data" in gd) {
							d.conn.send("error:Game already started.");
						}
						else {
							if(gd.users.length > 1) {
								startGame(id);
							}
							else {
								d.conn.send("error:You need at least two players");
							}
						}
					}
					else {
						d.conn.send("error:You aren't the game leader.");
					}
					return;
				}
			}
			d.conn.send("error:You aren't in a room.");
		}
	},
	attack: {
		data: true,
		handler: function(d) {
			var s = d.data.split(",");
			if(s.length == 2) {
				var src = parseInt(s[0]);
				var dst = parseInt(s[1]);
				for(var id in games) {
					var gd = games[id];
					var ind = gd.users.indexOf(d.user);
					if(ind>-1) {
						if("data" in gd && gd.data.gameStarted) {
							var owner = adjustForRemoved(gd, ind);
							if(src >= 0 && src < gd.data.nodes.length && dst >= 0 && dst < gd.data.nodes.length) {
								if(owner == gd.data.nodes[src].owner || gd.data.nodes[src].units[owner] > 0) {
									var size = Math.floor(gd.data.nodes[src].units[owner]);
									gd.data.nodes[src].units[ind] -= size;
									var group = {
										source: src,
										dest: dst,
										duration: Math.round(distance(gd.data.nodes[src], gd.data.nodes[dst])/gd.data.nodes[src].unitSpeed),
										size: size,
										owner: owner,
										id: nextGroupID()
									};
									broadcast("send:"+JSON.stringify(group), gd);
									group.start = new Date().getTime();
									if(!("unitgroups" in gd.data)) {
										gd.data.unitgroups = [];
									}
									gd.data.unitgroups.push(group);
								}
								else {
									d.conn.send("error:You don't own that node.");
								}
							}
							else {
								d.conn.send("error:That node doesn't exist.");
							}
						}
						else {
							d.conn.send("error:Game not started");
						}
						return;
					}
				}
				d.conn.send("error:You aren't in a room.");
			}
			else {
				d.conn.send("error:Invalid attack");
			}
		}
	},
	keepalive: {
		data: false,
		handler: function() {}
	},
	chat: {
		data: true,
		handler: function(d) {
			var room = getRoom(d.user);
			if(room) {
				broadcast("chat:"+logins[d.user].name+":"+d.data, games[room], 9);
			}
			else {
				d.conn.send("error:You're not in a room.");
			}
		}
	}
};

var handleMessage = function(user, message) {
	if(!(user in logins)) {
		console.log("User sent a message after leaving?");
		return;
	}
	if(message !== "keepalive") {
		console.log(user+": "+message);
	}
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
			info.handler({
				data: data,
				user: user,
				conn: conn
			});
		}
	}
	else {
		conn.send("error:Invalid command");
	}
};

var sync = function(gd) {
	gd.lastSync = new Date().getTime();
	var syncData = {
		nodes: [],
		groups: {}
	};
	for(var i = 0; i < gd.data.nodes.length; i++) {
		var ta = {
			owner: gd.data.nodes[i].owner,
			units: {}
		};
		for(var u in gd.data.nodes[i].units) {
			var v = gd.data.nodes[i].units[u];
			if(v > 0) {
				ta.units[u] = Math.floor(v);
			}
		}
		syncData.nodes.push(ta);
	}
	if("unitgroups" in gd.data) {
		for(var i = 0; i < gd.data.unitgroups.length; i++) {
			var group = gd.data.unitgroups[i];
			syncData.groups[group.id] = group.size;
		}
	}
	broadcast("sync:"+JSON.stringify(syncData), gd);
};

var lastTick = -1;

var tick = function() {
	var time = new Date().getTime();
	for(var id in games) {
		var gd = games[id];
		if("data" in gd) {
			var groupsUncontested = true;
			var unitsUncontested = true;
			if("unitgroups" in gd.data && gd.data.unitgroups.length > 0) {
				var groups = gd.data.unitgroups;
				var lastOwner = groups[0].owner;
				for(var i = 0; i < groups.length; i++) {
					var group = groups[i];
					// check if any groups have a different owner
					if (group.owner != lastOwner) {
						groupsUncontested = false;
					}
					lastOwner = group.owner;
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
			var nodeWinner = -1;
			for(var i = 0; i < gd.data.nodes.length; i++) {
				var node = gd.data.nodes[i];
				if(!("units" in node)) {
					node.units = {};
				}
				if(nodeWinner == node.owner || node.owner == -1 || nodeWinner == -1) {
					if(node.owner != -1) {
						nodeWinner = node.owner;
					}
				}
				else {
					unitsUncontested = false;
				}
				for(var owner in node.units) {
					if(owner != node.owner && node.units[owner] > 0) {
						unitsUncontested = false;
					}
				}
				if(node.owner != -1) {
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
				}
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
				var keepTransform = false;
				if(rightfulOwner >= 0) {
					if(node.owner != rightfulOwner) {
						keepTransform = true;
						if(node.transformTo != rightfulOwner) {
							node.owner = -1;
							broadcast("update:"+i+",owner,-1", gd);
							node.transformBegin = new Date().getTime();
							node.transformTo = rightfulOwner;
						}
						else if(new Date().getTime()-node.transformBegin > GAMERULES.TRANSFORM_TIME) {
							node.owner = rightfulOwner;
							broadcast("update:"+i+",owner,"+node.owner, gd);
							keepTransform = false;
						}
					}
				}
				if(!keepTransform) {
					delete node.transformBegin;
					delete node.transformTo;
				}
			}
			// if the same person controls all unit groups and nodes, they win
			if(groupsUncontested && unitsUncontested) {
				if(!("unitgroups" in gd.data && gd.data.unitgroups.length > 0) || gd.data.unitgroups[0].owner == nodeWinner) {
					handleWin(id, nodeWinner);
				}
			}
			if("data" in gd && (!("lastSync" in gd) || time-gd.lastSync > 5000)) {
				sync(gd);
			}
		}
		else {
			if(id.indexOf("matchme") == 0 && gd.created + GAMERULES.MATCH_WAIT_TIME <= time && gd.users.length > 1) {
				startGame(id);
			}
		}
		if(gd.users.length < 1 && !("data" in gd)) {
			if("spectators" in gd) {
				for(var i = 0; i < gd.spectators.length; i++) {
					var user = gd.spectators[i];
					logins[user].conn.send("leave:"+logins[user].name);
				}
			}
			delete games[id];
		}
	}
	lastTick = time;
};

setInterval(tick, 0);

var handleLostConnection = function(user) {
	removeUserFromGames(user, true);
	if(user in logins) {
		if(logins[user].conn == this) { // sometimes it's not, I don't know why
			console.log(logins[user].name+" left");
			delete logins[user];
		}
	}
};

var handleLogin = function(conn, id, version) {
	console.log(id+" logged in!");
	if(id in logins) {
		var tconn = logins[id].conn;
		tconn.send("error:You logged in from another location");
		tconn.close();
	}
	logins[id] = {conn: conn, name: id, version: version};
	conn.send("join:"+logins[id].name);
	conn.on("message", handleMessage.bind(conn, id));
	conn.on("close", handleLostConnection.bind(conn, id));
};

var sockserve = new ws.Server({server: webserve});
sockserve.on('connection', function(conn) {
	var func = function(message) {
		// this is called the first time the server receives a message
		// it should be an auth message
		conn.removeListener("message", func);
		var s = message.split(":");
		if((s.length == 4 || s.length == 2) && s[0] == "auth") {
			// yes, it is
			var version = parseInt(s.length==2?s[1]:s[3]);
			if(version == PROTOCOL_VERSION || COMPATIBLE_VERSIONS.indexOf(version) > -1) {
				if(s.length == 2) {
					// guest login
					var id;
					while(true) {
						id = "guest"+(Math.random()+"").substring(2);
						if(!(id in logins)) {
							break;
						}
					}
					handleLogin(conn, id, version);
				}
				else {
					db.query("SELECT * FROM users WHERE name=$1", [s[1]], function(err, result) {
						if(err) {
							console.error("QUERY IS SCRUBLORD", err);
							conn.send("error:query is scrublord");
							conn.close();
						}
						else if(result.rows.length == 1) {
							password.verify(s[2], result.rows[0].passhash, function(x, data) {
								if(!x && data) {
									handleLogin(conn, s[1], version);
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
			}
			else {
				if(version > PROTOCOL_VERSION) {
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

module.exports = {PROTOCOL_VERSION: PROTOCOL_VERSION};
