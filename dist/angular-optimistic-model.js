angular.module('rt.optimisticcache', []).factory('optimisticCache', function () {
  /*
     * Magical call caching.
     *
     * The code below provides a call cache. Basically we'll cache any call and
     * optimistically set the result on the scope, if possible. The call is
     * still executed as usual and the result will be merged on the scope. The
     * promise is only resolved after the call completes.
     *
     * The effect of this is that CRUD get / getAll calls appear to happen
     * instantly: The scope immediately gets the data. But we still maintain
     * data consistency: calls happen in the background and new data is merged
     * in when available.
     */
  var cache = {};
  // Get a cached result.
  function fetchFromCache(url) {
    return cache[url];
  }
  // Store in cache
  function cacheResult(url, result, options) {
    if (!options) {
      options = {};
    }
    if (options.mapper) {
      if (angular.isArray(result)) {
        for (var j = 0; j < result.length; j++) {
          result[j] = options.mapper(result[j]);
        }
      } else {
        result = options.mapper(result);
      }
    }
    merge(cache, url, result);
    if (angular.isArray(result) && options.populateChildren) {
      // Cache dependents of getAll call (partial results)
      for (var i = 0; i < result.length; i++) {
        var obj = result[i];
        cacheResult(url + '/' + obj[options.idField], obj);
      }
    }
  }
  // Merge results, rather than override, to make sure references stay intact.
  //
  // Results from getAll are used to pre-populate the individual object cache.
  // We use copies here to make sure that they're different objects: we don't
  // want to overwrite objects in the getAll cache when a get result comes in.
  function merge(parent, field, obj) {
    if (!obj) {
      return;
    }
    if (!parent[field]) {
      parent[field] = obj;
    } else {
      var target = parent[field];
      if (angular.isArray(target)) {
        for (var i = 0; i < obj.length; i++) {
          merge(target, i, angular.copy(obj[i]));
        }
        target.length = obj.length;
      } else {
        for (var key in obj) {
          target[key] = obj[key];
        }
      }
    }
  }
  // Augments the promise with a toScope method, which assigns the result of
  // the call to the scope.
  function optimisticCache(promise, url, options) {
    if (!options) {
      options = {};
    }
    if (options.idField === null || options.idField === undefined) {
      options.idField = 'id';
    }
    if (options.populateChildren === null || options.populateChildren === undefined) {
      options.populateChildren = true;
    }
    // Cache all calls (regardless of whether toScope is used).
    promise.then(function (obj) {
      cacheResult(url, obj, options);
    });
    // Decorate the promise with a toScope method.
    promise.toScope = function toScope(scope, field) {
      // Fill from cache initially
      merge(scope, field, fetchFromCache(url));
      // Wait for completion
      promise.then(function () {
        // Merge result to scope, from cache (it's cached in the first promise watcher)
        merge(scope, field, fetchFromCache(url));
      });
      // Return promise for chaining
      return promise.then(function () {
        return scope[field];
      });
    };
    return promise;
  }
  // Clears all cached results.
  optimisticCache.clear = function () {
    cache = {};
  };
  return optimisticCache;
});
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
      },
      clear: function () {
        cache = {};
      },
      cache: storeInCache
    };
  return Model;
});