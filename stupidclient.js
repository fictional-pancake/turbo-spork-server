var ws = require('ws');

var s = new ws('ws://localhost:5000');
s.onopen = function() {
	s.send("auth:"+process.argv[2]+":"+process.argv[3]+":7");
};
var joined = false;
s.onmessage = function(d) {
	console.log(d.data);
	if(!joined || d.data == "leave:"+process.argv[2]) {
		s.send("join:"+process.argv[4]);
		joined = true;
	}
};
s.onclose = function() {
	console.log("Lost connection");
	process.exit();
};
setInterval(function(){},0);
