var ws = require('ws');
var parseArgs = require('minimist');

var opts = parseArgs(process.argv, {
	default: {
		url: "ws://localhost:5000",
		ai: false
	},
	alias: {
		"u": "username",
		"p": "password"
	}
});

var ai = null;
var s = new ws(opts.url);
s.onopen = function() {
	s.send("auth:"+opts.username+":"+opts.password+":9");
};
var joined = false;
var users;
var maybeStart = function() {
	if(users.length > 1 && users[0] == opts.username) {
		s.send("gamestart");
	}
};
s.onmessage = function(d) {
	console.log(d.data);
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
	if(opts.ai && d.data.indexOf("gamestart") == 0) {
		var pos = users.indexOf(opts.username);
		var j = JSON.parse(d.data.substring(10));
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
};
s.onclose = function() {
	console.log("Lost connection");
	process.exit();
};
setInterval(function(){
	if(ai) {
		console.log(ai.mynodes);
		s.send("attack:"+ai.mynodes[Math.floor(Math.random()*ai.mynodes.length)]+","+Math.floor(Math.random()*ai.nodecount));
	}
},1000);
