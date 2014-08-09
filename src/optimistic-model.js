angular.module("rt.optimisticmodel", []).factory("Model", function ($q, $rootScope) {
    var defaultOptions = {
        idField: "id",
        populateChildren: true,
        useCached: false
    };

    var cache = {};
    var modelOptionsKey = "modelOptions";

    function newInstance(Class, data) {
        var obj = new Class();

        if (data && data.toJSON) {
            data = data.toJSON();
        }

        if (obj.fromJSON) {
            obj.fromJSON(data);
        } else {
            for (var field in data) {
                obj[field] = data[field];
            }
        }
        return obj;
    }

    function clone(obj) {
        return newInstance(obj.constructor, obj);
    }

    function storeInCache(key, data) {
        mergeInto(cache, key, data);
        $rootScope.$broadcast("modelCached", key, cache[key]);
    }

    function fillCache(Class, options, key, data) {
        if (angular.isArray(data)) {
            var results = [];
            for (var i = 0; i < data.length; i++) {
                var obj = newInstance(Class, data[i]);
                if (options.populateChildren) {
                    storeInCache(key + "/" + obj[options.idField], obj);
                }
                results.push(obj);
            }
            storeInCache(key, results);
        } else {
            storeInCache(key, newInstance(Class, data));
        }
    }

    function mergeInto(target, key, data) {
        if (!target[key]) {
            target[key] = data;
            return;
        }

        if (target[key] === data) {
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

    function mkToScopeMethod(promise, key, cloned) {
        cloned = !!cloned;
        promise.toScope = function (scope, field) {
            if (cache[key]) {
                var obj = cache[key];
                updateScope(scope, field, cloned ? clone(obj) : obj);
            }

            promise.then(function (result) {
                updateScope(scope, field, result);
            });

            return promise.then(function () {
                return scope[field];
            });
        };
    }

    function mkResolved(result) {
        var deferred = $q.defer();
        deferred.resolve(result);
        return deferred.promise;
    }

    function getAll(Class, options) {
        var key = options.ns;
        var promise = null;

        if (options.useCached && cache[key]) {
            promise = mkResolved(cache[key]);
        } else {
            promise = options.backend("GET", key).then(function (data) {
                fillCache(Class, options, key, data);
                return cache[key];
            });
        }

        mkToScopeMethod(promise, key);
        return promise;
    }

    function get(Class, options, id) {
        var key = options.ns + "/" + id;
        var cloned = !!options.cloned;
        var promise = null;

        if (options.useCached && cache[key]) {
            promise = mkResolved(cache[key]);
        } else {
            promise = options.backend("GET", key).then(function (result) {
                fillCache(Class, options, key, result);
                return cloned ? clone(cache[key]) : cache[key];
            });
        }

        mkToScopeMethod(promise, key, cloned);
        return promise;
    }

    function update(Class, options, obj, fields) {
        var data = obj;
        if (fields) {
            data = {};
            for (var i = 0; i < fields.length; i++) {
                data[fields[i]] = obj[fields[i]];
            }
        }

        var key = options.ns + "/" + obj[options.idField];
        var promise = options.backend("PUT", key, data).then(function (result) {
            var obj = newInstance(Class, result);
            storeInCache(key, obj);
            return cache[key];
        });

        mkToScopeMethod(promise, key);
        return promise;
    }

    function destroy(Class, options, obj) {
        var id = typeof obj === "object" ? obj[options.idField] : obj;
        var key = options.ns + "/" + id;
        return options.backend("DELETE", key).then(function () {
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

    function create(Class, options, obj) {
        return options.backend("POST", options.ns, obj).then(function (data) {
            var obj = newInstance(Class, data);
            var key = options.ns + "/" + obj[options.idField];
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
        var self = this;
        var options = self.constructor[modelOptionsKey];

        var promise = null;
        if (!self[options.idField]) {
            promise = self.create();
        } else {
            promise = self.update();
        }

        $rootScope.$broadcast("modelSaveStarted", self, promise);
        promise.finally(function () {
            $rootScope.$broadcast("modelSaveEnded", self, promise);
        });

        return promise;
    }

    function staticMethod(cls, fn, optionsOverride) {
        return function () {
            var options = angular.extend({}, cls[modelOptionsKey], optionsOverride);
            return fn.apply(null, [cls, options].concat(Array.prototype.slice.call(arguments, 0)));
        };
    }

    function method(fn) {
        return function () {
            return fn(this.constructor, this.constructor[modelOptionsKey], this);
        };
    }

    var Model = {
        defaults: function (defaults) {
            defaultOptions = angular.extend(defaultOptions, defaults);
        },

        extend: function (cls, options) {
            cls.getAll = staticMethod(cls, getAll);
            cls.get = staticMethod(cls, get);
            cls.getCached = staticMethod(cls, get, { useCached: true });
            cls.getClone = staticMethod(cls, get, { cloned: true });
            cls.update = staticMethod(cls, update);
            cls.delete = staticMethod(cls, destroy);
            cls.create = staticMethod(cls, create);
            cls.cache = staticMethod(cls, fillCache);
            cls[modelOptionsKey] = angular.extend({}, defaultOptions, options);

            var proto = cls.prototype;
            proto.update = method(update);
            proto.delete = method(destroy);
            proto.create = method(create);
            proto.save = save;
        },

        clear: function () {
            cache = {};
        },

        getCache: function (key) {
            return cache[key];
        },

        get: get,
        getAll: getAll,
        update: update,
        delete: destroy,
        create: create,
    };

    return Model;
});

// TODO: Use options from class (if available, override from options)
