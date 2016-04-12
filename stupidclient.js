var ws = require('ws');

var s = new ws('ws://localhost:5000');
s.onopen = function() {
	s.send("auth:"+process.argv[2]+":"+process.argv[3]+":1");
};
var joined = false;
s.onmessage = function(d) {
	console.log(d.data);
	if(!joined) {
		s.send("join:"+process.argv[4]);
		joined = true;
	}
};
setInterval(function(){},0);
