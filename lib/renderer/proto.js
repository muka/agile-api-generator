var _ = require("lodash");
var d = require("debug")("agile:gen:render:dbux-xml");
var fs = require('fs');
var util = require('../util');
var YAML = require('yamljs');

var docLink = "http://agile-iot.github.io/agile-api-spec/docs/html/api.html";

var dbusTypes = {
  "INT16": "n",
  "UINT16": "q",
  "UINT32": "u",
  "INT64": "x",
  "UINT64": "t",
  "SIGNATURE": "g",

  "UNIX_FD": "h",
  "BYTE": "y",
  "BOOLEAN": "b",
  "OBJECT_PATH": "o",
  "STRING": "s",
  "INT32": "i",
  "DOUBLE": "d",
  "STRUCT": "r",
  "ARRAY": "a",
  "VARIANT": "v",

};

var ProtobufRenderer = function (definition) {

  this.definition = definition;

  var tpl = util.tpl("protobuf", "proto");

  this.templates = {
    root: tpl("root"),
    type: tpl("type"),
  };

};

ProtobufRenderer.prototype.getReference = function (typeName) {

  if(!typeName) return null;

  if(this.definition.classes[typeName]) {
    return this.definition.classes[typeName];
  }
  if(this.definition.types[typeName]) {
    return this.definition.types[typeName];
  }
  return null;
};

ProtobufRenderer.prototype.getDBusType = function (type, tname) {

  var typeName = type.type ? type.type.toLowerCase() : null;

  // type is a class
  if(type.isClass()) {
    return dbusTypes.OBJECT_PATH;
  }

  // type refer to a structured type
  var typeRef = this.getReference(type.type);
  if(typeRef) {
    return this.getDBusType(typeRef);
  }

  // type has a reference field to a type
  typeRef = this.getReference(type.reference);
  if(typeRef) {
    return this.getDBusType(typeRef);
  }

  if(typeName === 'string') {
    return dbusTypes.STRING;
  }

  if(typeName === 'boolean') {
    return dbusTypes.BOOLEAN;
  }

  // todo: fix number in spec
  if(typeName === 'number') {
    return dbusTypes.DOUBLE;
  }
  if(typeName === 'int' || typeName === 'int32') {
    return dbusTypes.INT32;
  }
  if(typeName === 'double') {
    return dbusTypes.DOUBLE;
  }

  if(typeName === 'byte') {
    return dbusTypes.BYTE;
  }

  if(typeName === 'object*') {
    return dbusTypes.VARIANT;
  }

  if(type.isArray()) {

    var typeDef;
    var ref = type.reference ? this.getReference(type.reference) : null;
    if(ref) {
      typeDef = this.getDBusType(ref);
    }

    if(!typeDef) {
      ref = type.type ? this.getReference(type.type) : null;
      if(ref) {
        typeDef = this.getDBusType(ref);
      }
    }

    if(!typeDef) {
      ref = type.fields.__arrayType || null;
      if(ref) {
        typeDef = this.getDBusType(ref);
      }
    }

    if(!typeDef) {
      console.error("Cannot get type definition, is it missing ? %j", type.data);
      throw new Error("Cannot get type definition for " + (type.name || type.type));
    }

    return "(" + typeDef + ")";
  }

  // default enum to int
  if(type.isEnum()) {
    var values = type.getEnumValues();
    return "(i)";
  }

  if(typeName === 'object') {
    return "{" +
      _.values(_.map(type.fields, this.getDBusType.bind(this))).join("") +
      "}";
  }

  throw new Error("Cannot map type " + typeName);
};

ProtobufRenderer.prototype.renderMethod = function (method, methodName) {

  var me = this;

  var comment = this.renderComment(method);

  var args = [];
  if(method.args)
    _.forEach(method.args, function (arg, argName) {
      args.push({
        name: argName,
        type: me.getDBusType(arg),
        direction: "in"
      });
    });

  if(method.return && method.return.type !== 'void') {
    var typeDefinition = me.getDBusType(method.return);
    args.push({
      name: "return",
      type: typeDefinition,
      direction: "out"
    });
  }

  var annotations = [];
  return this.templates.method({
    comment: comment,
    method: {
      name: methodName,
      args: args,
      annotations: annotations
    }
  });
};

ProtobufRenderer.prototype.renderSignal = function (property, typeDefinition) {

  var me = this;

  var name = property.name;

  var events = property.getEvents();
  if(!events.length) {
    events = [ name + 'Changed' ];
  }

  // console.warn(property.parent.name, events);

  return _.values(_.map(events, function(eventName) {
    return me.templates.signal({
      signal: {
        name: eventName,
        args: [
          {
            name: name,
            type: typeDefinition
          }
        ],
      }
    });
  })).join("");
};

ProtobufRenderer.prototype.renderComment = function (type) {
  return "  @see " +
    type.parent.name + '.' + type.name +
    "\n    @link "+ docLink +"#" +
      type.parent.name.replace(/\./g, '_') + '_' + type.name
  ;
};

ProtobufRenderer.prototype.renderProperty = function (property, propertyName) {

  var access = "read";
  if(property.access) {
    access = (property.canRead() && property.canWrite()) ? "readwrite" :
      property.canWrite() ? "write" : access;
  }

  var type = this.getDBusType(property);

  var comment = this.renderComment(property);

  var output = this.templates.property({
    comment: comment,
    property: {
      name: propertyName,
      type: type,
      access: access
    }
  });

  if(property.canSubscribe()) {
    output += this.renderSignal(property, type);
  }

  return output;
};

ProtobufRenderer.prototype.renderMethods = function (clazz) {

  var content = "";

  if(_.size(clazz.methods))
    content +=
    _.values(
      _.map(clazz.methods, this.renderMethod.bind(this))
    ).join("\n");

  // add property
  // if(_.size(clazz.properties))
  //   content +=
  //   _.values(
  //     _.map(clazz.properties, this.renderProperty.bind(this))
  //   ).join("\n");

  return {
    name: clazz.name,
    content: content
  };
};

ProtobufRenderer.prototype.renderClass = function (clazz) {

console.log(clazz);
process.exit()

  var dbusName = clazz.dbus && clazz.dbus.name || "/" + clazz.name.replace(/\./g, "/");
  return {
    filename: clazz.name + ".proto",
    content: this.templates.root({
      api: {
        name: dbusName,
        methods: [
          this.renderMethods(clazz)
        ]
    },
    classes: this.renderClasses(clazz)
    })
  };

};

ProtobufRenderer.prototype.render = function () {
  var files = _.values(
    _.map(
      this.definition.classes, this.renderClass.bind(this)
    )
  );
  return files;
};

module.exports = function (definition) {
  return Promise.resolve((new ProtobufRenderer(definition)).render());
};
