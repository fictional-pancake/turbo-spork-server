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
  db.createTable("tokens", {
    id: {type: "string", primaryKey: true},
    user: "string",
    created: "datetime"
  }, callback);
};

exports.down = function(db, callback) {
  db.dropTable("tokens", callback);
};
