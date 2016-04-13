var PROTOCOL_VERSION = require('../index').PROTOCOL_VERSION;
var assert = require('assert');
var ws = require('ws');
var http = require('http');
var querystring = require('querystring');
var async = require('async');

var PORT = process.env.PORT || 5000;
var USERNAME = "testuser"+(Math.random()+"").substring(2);
var USERNAME2 = "testuser"+(Math.random()+"").substring(2);
var PASSWORD = "thisisapassword";
var ROOM = "test";

var callbackManager = {
	callbacks: {},
	register: function(id, callback) {
		if(id in this.callbacks) {
			if("value" in this.callbacks[id]) {
				callback(null, this.callbacks[id].value);
			}
		}
		else {
			this.callbacks[id] = {callbacks: []};
		}
		this.callbacks[id].callbacks.push(callback);
	},
	complete: function(id, value) {
		if(!(id in this.callbacks)) {
			this.callbacks[id] = {callbacks: []};
		}
		var cd = this.callbacks[id];
		for(var i = 0; i < cd.callbacks.length; i++) {
			cd.callbacks[i](null, value);
		}
		cd.value = value;
	},
	action: function(id) {
		return function(callback) {
			callbackManager.register(id, callback);
		};
	}
};

// test creating a user
var createUser = function(user, pass) {
	var postdata = querystring.stringify({
		"username": user,
		"password": pass
	});
	var req = http.request({
		port: PORT,
		path: "/signupaction",
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": postdata.length
		}
	});
	req.write(postdata);
	req.end();
};
createUser(USERNAME, PASSWORD);
createUser(USERNAME2, PASSWORD);

var state = 0;

var wsurl = 'ws://localhost:'+PORT;
var s = new ws(wsurl);
var s2 = new ws(wsurl);
async.parallel([
	function(callback) {
		s.onopen = function() {
			callback(null, s);
		};
	},
	function(callback) {
		s2.onopen = function() {
			callback(null, s2);
		};
	}
], function() {
	s.send("auth:"+USERNAME+":"+PASSWORD+":"+PROTOCOL_VERSION);
});
async.parallel([
	callbackManager.action("1got2"),
	callbackManager.action("2got1"),
	callbackManager.action("2got2")
], function() {
	state++;
	s.send("gamestart");
});
async.parallel([
	callbackManager.action("start1"),
	callbackManager.action("start2")
], function(err, res) {
	assert.equal(res[0], res[1]);
	state++;
	console.log("SUCCESS");
	process.exit(0);
});
s.onmessage = function(d) {
	console.log("MESSAGE to s: "+d.data);
	var msg = d.data;
	if(state == 0 || state == 1) {
		assert.equal(msg, "join:"+USERNAME);
		state++;
		if(state == 1) {
			s.send("join:"+ROOM);
		}
		else if(state == 2) {
			s2.send("auth:"+USERNAME2+":"+PASSWORD+":"+PROTOCOL_VERSION);
		}
	}
	else if(state == 3) {
		assert.equal(msg, "join:"+USERNAME2);
		callbackManager.complete("1got2", true);
	}
	else if(state == 4) {
		callbackManager.complete("start1", msg);
	}
};
s2.onmessage = function(d) {
	console.log("MESSAGE to s2: "+d.data);
	var msg = d.data;
	if(state == 2) {
		assert.equal(msg, "join:"+USERNAME2);
		state++;
		s2.send("join:"+ROOM);
	}
	else if(state == 3) {
		if(msg == "join:"+USERNAME) {
			callbackManager.complete("2got1", true);
		}
		else if(msg == "join:"+USERNAME2) {
			callbackManager.complete("2got2", true);
		}
		else {
			assert.fail(msg, "join:[some possible username]", false, "!=");
		}
	}
	else if(state == 4) {
		callbackManager.complete("start2", msg);
	}
};
