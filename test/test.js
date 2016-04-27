var PROTOCOL_VERSION = require('../index').PROTOCOL_VERSION;
var ws = require('ws');
var wstest = require('wstest');
var FormData = require('form-data');
var async = require('async');

var PORT = process.env.PORT || 5000;
var USERNAME = "testuser"+(Math.random()+"").substring(2);
var USERNAME2 = "testuser"+(Math.random()+"").substring(2);
var PASSWORD = "thisisapassword";
var MESSAGE = "This is test message";
var ROOM = "test";

var createUser = function(user, pass, callback) {
	var fd = new FormData();
	fd.append("username", user);
	fd.append("password", pass);
	fd.submit("http://localhost:"+PORT+"/signupaction", callback);
};

var ignored = function(msg) {
	return msg.indexOf("sync") == 0;
};

async.parallel([
	createUser.bind(null, USERNAME, PASSWORD),
	createUser.bind(null, USERNAME2, PASSWORD)
], function() {
	var wsurl = "ws://localhost:"+PORT;
	var s = new wstest(new ws(wsurl));
	s.logMessages = true;
	s.ignored = ignored;
	var s2 = new wstest(new ws(wsurl));
	s2.ignored = ignored;
	async.parallel([
		s.waitForOpen.bind(s),
		s2.waitForOpen.bind(s2)
	], function() {
		s.get().send("auth:"+USERNAME+":"+PASSWORD+":"+PROTOCOL_VERSION);
		s.waitForMessage("join:"+USERNAME, function() {
			// s is authenticated
			s.get().send("join:"+ROOM);
			s2.get().send("auth:"+USERNAME2+":"+PASSWORD+":"+PROTOCOL_VERSION);
			async.parallel([
				s.waitForMessage.bind(s, "join:"+USERNAME),
				s2.waitForMessage.bind(s2, "join:"+USERNAME2)
			], function() {
				// s is in the room, s2 is authenticated
				s2.get().send("join:"+ROOM);
				async.parallel([
					s.waitForMessage.bind(s, "join:"+USERNAME2),
					s2.waitForMessage.bind(s2, "join:"+USERNAME)
				], function() {
					s2.waitForMessage("join:"+USERNAME2, function() {
						// both are in the room
						s.get().send("gamestart");
						async.parallel([
							s.waitForMessage.bind(s),
							s2.waitForMessage.bind(s2)
						], function() {
							s.get().send("chat:"+MESSAGE);
							async.parallel([
								s.waitForMessage.bind(s, "chat:"+USERNAME+":"+MESSAGE),
								s.waitForMessage.bind(s2, "chat:"+USERNAME+":"+MESSAGE)
							], function() {
								// first chat
								s2.get().send("chat:"+MESSAGE);
								async.parallel([
									s.waitForMessage.bind(s, "chat:"+USERNAME2+":"+MESSAGE),
									s2.waitForMessage.bind(s2, "chat:"+USERNAME2+":"+MESSAGE)
								], function() {
									s.get().close();
									async.series([
										s2.waitForMessage.bind(s2, "leave:"+USERNAME),
										s2.waitForMessage.bind(s2, "win:"+USERNAME2)
									], function() {
										console.log("SUCCESS");
										process.exit(0);
									});
								});
							});
						});
					});
				});
			});
		});
	});
});
