angular.module('rt.optimisticmodel', []).factory('Model', function () {
  var defaultOptions = {
      idField: 'id',
      populateChildren: true
    };
  var cache = {};
  function newInstance(Class, data) {
    var obj = new Class();
    if (obj.fromJSON) {
      obj.fromJSON(data);
    } else {
      for (var field in data) {
        obj[field] = data[field];
      }
    }
    return obj;
  }
  function storeInCache(key, data) {
    mergeInto(cache, key, data);
  }
  function mergeInto(target, key, data) {
    if (!target[key]) {
      target[key] = data;
      return;
    }
    var targetObj = target[key];
    if (angular.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        targetObj[i] = data[i];
      }
      targetObj.length = data.length;
    } else {
      for (var field in data) {
        targetObj[field] = data[field];
      }
    }
  }
  function updateScope(scope, key, data) {
    mergeInto(scope, key, data);
  }
  function mkToScopeMethod(promise, key) {
    promise.toScope = function (scope, field) {
      if (cache[key]) {
        updateScope(scope, field, cache[key]);
      }
      promise.then(function (result) {
        updateScope(scope, field, result);
      });
      return promise;
    };
  }
  function getAll() {
    var self = this;
    var options = self.modelOptions;
    var key = options.ns;
    var promise = options.backend('GET', key).then(function (data) {
        var results = [];
        for (var i = 0; i < data.length; i++) {
          var obj = newInstance(self, data[i]);
          if (options.populateChildren) {
            storeInCache(key + '/' + obj[options.idField], obj);
          }
          results.push(obj);
        }
        storeInCache(key, results);
        return cache[key];
      });
    mkToScopeMethod(promise, key);
    return promise;
  }
  function get(id) {
    var self = this;
    var options = self.modelOptions;
    var key = options.ns + '/' + id;
    var promise = options.backend('GET', key).then(function (result) {
        var obj = newInstance(self, result);
        storeInCache(key, obj);
        return cache[key];
      });
    mkToScopeMethod(promise, key);
    return promise;
  }
  function update(obj, fields) {
    var self = this;
    if (!obj) {
      obj = self;
      self = obj.constructor;
    }
    var data = obj;
    if (fields) {
      data = {};
      for (var i = 0; i < fields.length; i++) {
        data[fields[i]] = obj[fields[i]];
      }
    }
    var options = self.modelOptions;
    var key = options.ns + '/' + obj[options.idField];
    var promise = options.backend('PUT', key, data).then(function (result) {
        var obj = newInstance(self, result);
        storeInCache(key, obj);
        return cache[key];
      });
    mkToScopeMethod(promise, key);
    return promise;
  }
  function destroy(obj) {
    var self = this;
    if (!obj) {
      obj = self;
      self = obj.constructor;
    }
    var options = self.modelOptions;
    var id = typeof obj === 'object' ? obj[options.idField] : obj;
    var key = options.ns + '/' + id;
    return options.backend('DELETE', key).then(function () {
      delete cache[key];
      // Remove from parent collection (if available)
      var parentColl = cache[options.ns];
      if (parentColl) {
        var index = -1;
        for (var i = 0; i < parentColl.length; i++) {
          if (parentColl[i][options.idField] === id) {
            index = i;
          }
        }
        if (index > -1) {
          parentColl.splice(index, 1);
        }
      }
    });
  }
  function create(obj) {
    var self = this;
    if (!obj) {
      obj = self;
      self = obj.constructor;
    }
    var options = self.modelOptions;
    return options.backend('POST', options.ns, obj).then(function (data) {
      var obj = newInstance(self, data);
      var key = options.ns + '/' + obj[options.idField];
      storeInCache(key, obj);
      var result = cache[key];
      // Add to parent collection (if available)
      var parentColl = cache[options.ns];
      if (parentColl) {
        var found = false;
        for (var i = 0; i < parentColl.length; i++) {
          if (parentColl[i][options.idField] === obj[options.idField]) {
            found = true;
          }
        }
        if (!found) {
          parentColl.push(result);
        }
      }
      return result;
    });
  }
  function save() {
    var options = this.constructor.modelOptions;
    if (!this[options.idField]) {
      return this.create();
    } else {
      return this.update();
    }
  }
  var Model = {
      defaults: function (defaults) {
        defaultOptions = angular.extend(defaultOptions, defaults);
      },
      extend: function (cls, options) {
        cls.getAll = getAll;
        cls.get = get;
        cls.update = update;
        cls.delete = destroy;
        cls.create = create;
        cls.modelOptions = angular.extend({}, defaultOptions, options);
        var proto = cls.prototype;
        proto.update = update;
        proto.delete = destroy;
        proto.create = create;
        proto.save = save;
      },
      clear: function () {
        cache = {};
      },
      cache: storeInCache
    };
  return Model;
});