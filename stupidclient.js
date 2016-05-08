var PROTOCOL_VERSION = 11;

var ws = require('ws');

var defaults = {
	url: "ws://localhost:5000",
	ai: false,
	rejoin: true,
	log: true
};

var runBot = function(opts) {
	for(var k in defaults) {
		if(!(k in opts)) {
			opts[k] = defaults[k];
		}
	}
	var ai = null;
	var s = new ws(opts.url);
	s.onopen = function() {
		if("username" in opts) {
			s.send("auth:"+opts.username+":"+opts.password+":"+PROTOCOL_VERSION);
		}
		else {
			s.send("auth:"+PROTOCOL_VERSION);
		}
		setInterval(function() {
			s.send("keepalive");
		}, 10000);
	};
	var joined = false;
	var users;
	var maybeStart = function() {
		if(users.length > 1 && users[0] == opts.username) {
			s.send("gamestart");
		}
	};
	s.onmessage = function(d) {
		if(opts.log) console.log(d.data);
		if(!joined || d.data == "leave:"+opts.username) {
			s.send("join:"+opts.room);
			joined = true;
			users = [];
			ai = null;
		}
		else if(d.data.indexOf("join") == 0) {
			users.push(d.data.substring(5));
			maybeStart();
		}
		else if(d.data.indexOf("leave") == 0) {
			users.splice(users.indexOf(d.data.substring(6)),1);
		}
		else if(d.data.indexOf("win") == 0) {
			ai = null;
			maybeStart();
		}
		else if(d.data.indexOf("update") == 0) {
			var sp = d.data.substring(7).split(",");
			if(sp[1] == "owner" && ai) {
				var id = parseInt(sp[0]);
				if(sp[2] == users.indexOf(opts.username)) {
					ai.mynodes.push(id);
				}
				else {
					var ind = ai.mynodes.indexOf(id);
					if(ind > -1) {
						ai.mynodes.splice(ind,1);
					}
				}
			}
		}
		if(opts.ai && d.data.indexOf("gameinfo") == 0) {
			var pos = users.indexOf(opts.username);
			var j = JSON.parse(d.data.substring(9));
			ai = {
				mynodes: [],
				nodecount: j.nodes.length
			};
			for(var i = 0; i < j.nodes.length; i++) {
				if(j.nodes[i].owner == pos) {
					ai.mynodes.push(i);
				}
			}
		}
		else if(ai && d.data == "gamestart") {
			ai.active = true;
		}
	};
	s.onclose = function() {
		if(opts.log) console.log("Lost connection");
		if(require.main === module) {
			process.exit();
		}
	};
	setInterval(function(){
		if(ai && ai.active) {
			if(opts.log) console.log(ai.mynodes);
			s.send("attack:"+ai.mynodes[Math.floor(Math.random()*ai.mynodes.length)]+","+Math.floor(Math.random()*ai.nodecount));
		}
	},1000);
};
if(require.main === module) {
	var parseArgs = require('minimist');
	
	var opts = parseArgs(process.argv, {
		default: defaults,
		alias: {
			"u": "username",
			"p": "password"
		}
	});
	runBot(opts);
}
module.exports = runBot;
