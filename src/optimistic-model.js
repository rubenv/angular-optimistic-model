angular.module("rt.optimisticmodel", []).factory("Model", function ($q, $rootScope) {
    var cloneParent = "$$cloneParent";

    var defaultOptions = {
        idField: "id",
        populateChildren: true,
        useCached: false,
        useCachedChildren: true, // Only applies when useCached is true.
    };

    var cache = {};

    function getOptions(Class, options) {
        return angular.extend({}, Class.modelOptions, options);
    }

    function newInstance(Class, data) {
        var obj = new Class();

        if (data && data.toJSON) {
            data = data.toJSON();
        }

        data = angular.copy(data);

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
        var newObj = newInstance(obj.constructor, obj);
        newObj[cloneParent] = obj;
        return newObj;
    }

    function storeInCache(key, data) {
        mergeInto(cache, key, data);
        $rootScope.$broadcast("modelCached", key, cache[key]);
    }

    function fillCache(Class, options, key, data) {
        var opts = getOptions(Class, options);

        if (!data && angular.isArray(key)) {
            data = key;
            key = opts.ns;
        }
        if (!data && angular.isObject(key)) {
            data = key;
            key = opts.ns + "/" + data[opts.idField];
        }
        if (!data) {
            return;
        }

        if (angular.isArray(data)) {
            var results = [];
            for (var i = 0; i < data.length; i++) {
                var obj = newInstance(Class, data[i]);
                if (opts.populateChildren) {
                    storeInCache(key + "/" + obj[opts.idField], obj);
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
                if (field[0] !== "_") {
                    targetObj[field] = data[field];
                }
            }
        }
    }

    function updateScope(scope, key, data, idField) {
        if (idField && scope[key] && scope[key][idField] && scope[key][idField] !== data[idField]) {
            // There was already an object on the scope, but it has a different
            // ID. We can't blindly merge changes into it, because that will
            // destroy the state of the previous object. Forcing a new
            // reference by clearing the scope field.
            delete scope[key];
        }
        mergeInto(scope, key, data);
    }

    function mkToScopeMethod(promise, key, cloned, idField) {
        cloned = !!cloned;
        promise.toScope = function (scope, field) {
            if (cache[key]) {
                var obj = cache[key];
                updateScope(scope, field, cloned ? clone(obj) : obj, idField);
            }

            promise.then(function (result) {
                updateScope(scope, field, result, idField);
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

    function emit(event, obj, promise) {
        $rootScope.$broadcast("model" + event + "Started", obj, promise);
        promise.finally(function () {
            $rootScope.$broadcast("model" + event + "Ended", obj, promise);
        });
    }

    function getAll(Class, options) {
        var opts = getOptions(Class, options);
        var key = opts.ns;
        var promise = null;

        if (opts.useCached && cache[key]) {
            promise = mkResolved(cache[key]);
        } else {
            promise = opts.backend("GET", key).then(function (data) {
                fillCache(Class, options, key, data);
                return cache[key];
            });
        }

        mkToScopeMethod(promise, key);
        return promise;
    }

    function get(Class, options, id) {
        var opts = getOptions(Class, options);
        var key = opts.ns + "/" + id;
        var cloned = !!opts.cloned;
        var promise = null;

        if (opts.useCached && opts.useCachedChildren && cache[key]) {
            promise = mkResolved(cloned ? clone(cache[key]) : cache[key]);
        } else {
            promise = opts.backend("GET", key).then(function (result) {
                fillCache(Class, options, key, result);
                return cloned ? clone(cache[key]) : cache[key];
            });
        }

        mkToScopeMethod(promise, key, cloned, opts.idField);
        return promise;
    }

    function update(Class, options, obj, fields) {
        var opts = getOptions(Class, options);

        var data = obj;
        if (fields) {
            data = {};
            for (var i = 0; i < fields.length; i++) {
                data[fields[i]] = obj[fields[i]];
            }
        }

        var key = opts.ns + "/" + obj[opts.idField];
        var promise = opts.backend("PUT", key, data).then(function (result) {
            var obj = newInstance(Class, result);
            storeInCache(key, obj);
            return cache[key];
        });

        mkToScopeMethod(promise, key);
        return promise;
    }

    function destroy(Class, options, obj) {
        var opts = getOptions(Class, options);
        var id = typeof obj === "object" ? obj[opts.idField] : obj;
        var key = opts.ns + "/" + id;

        var promise = opts.backend("DELETE", key).then(function () {
            delete cache[key];

            // Remove from parent collection (if available)
            var parentColl = cache[opts.ns];
            if (parentColl) {
                var index = -1;
                for (var i = 0; i < parentColl.length; i++) {
                    if (parentColl[i][opts.idField] === id) {
                        index = i;
                    }
                }

                if (index > -1) {
                    parentColl.splice(index, 1);
                }
            }
        });

        emit("Delete", obj, promise);

        return promise;
    }

    function create(Class, options, obj) {
        var opts = getOptions(Class, options);
        return opts.backend("POST", opts.ns, obj).then(function (data) {
            var obj = newInstance(Class, data);
            var key = opts.ns + "/" + obj[opts.idField];
            storeInCache(key, obj);
            var result = cache[key];

            // Add to parent collection (if available)
            var parentColl = cache[opts.ns];
            if (parentColl) {
                var found = false;
                for (var i = 0; i < parentColl.length; i++) {
                    if (parentColl[i][opts.idField] === obj[opts.idField]) {
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
        var options = self.constructor.modelOptions;

        var promise = null;
        if (!self[options.idField]) {
            promise = self.create();
        } else {
            promise = self.update();
        }

        emit("Save", self, promise);

        return promise;
    }

    function hasChanges() {
        if (!this[cloneParent]) {
            throw new Error("Only works on clones!");
        }

        return !angular.equals(this, this[cloneParent]);
    }

    function staticMethod(cls, fn, optionsOverride) {
        return function () {
            var options = angular.extend({}, cls.modelOptions, optionsOverride);
            return fn.apply(null, [cls, options].concat(Array.prototype.slice.call(arguments, 0)));
        };
    }

    function method(fn) {
        return function () {
            var args = [this.constructor, this.constructor.modelOptions, this].concat(Array.prototype.slice.call(arguments, 0));
            return fn.apply(null, args);
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
            cls.modelOptions = angular.extend({}, defaultOptions, options);

            var proto = cls.prototype;
            proto.update = method(update);
            proto.delete = method(destroy);
            proto.create = method(create);
            proto.save = save;
            proto.hasChanges = hasChanges;
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
