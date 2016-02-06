'use strict';

var dbm;
var type;
var seed;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function(db, callback) {
  db.createTable("users", {
    id: {type: "int", primaryKey: true},
    name: "string",
    salt: "string",
    passhash: "string"
  }, function() {
    console.log("Done!");
    callback();
  });
};

exports.down = function(db, callback) {
  db.dropTable("users", callback);
};
