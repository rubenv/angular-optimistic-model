angular.module("rt.optimisticmodel", []).factory("Model", function ($q, $rootScope) {
    var cloneParent = "$$cloneParent";
    var snapshotField = "$$snapshot";
    var modelCachedEvent = "modelCached";

    var defaultOptions = {
        idField: "id",
        populateChildren: true,
        useCached: false,
        useCachedChildren: true, // Only applies when useCached is true.
    };

    var cache = {};

    function getOptions(Class, options, extra) {
        return angular.extend({}, Class.modelOptions, options, extra || {});
    }

    function newInstance(Class, data) {
        var field;
        var obj = new Class();

        if (data && data.toJSON) {
            data = data.toJSON();
        }

        if (obj.fromJSON) {
            var newData = {};
            for (field in data) {
                if (field[0] !== "$" && data.hasOwnProperty(field)) {
                    newData[field] = angular.copy(data[field]);
                }

            }
            obj.fromJSON(newData);
        } else {
            for (field in data) {
                if (field[0] !== "$" && data.hasOwnProperty(field)) {
                    obj[field] = angular.copy(data[field]);
                }
            }
        }
        return obj;
    }

    function clone(obj) {
        if (angular.isArray(obj)) {
            var result = [];
            for (var i = 0; i < obj.length; i++) {
                result[i] = clone(obj[i]);
            }
            return result;
        } else {
            var newObj = newInstance(obj.constructor, obj);
            newObj[cloneParent] = obj;
            return newObj;
        }
    }

    function storeInCache(key, data) {
        mergeInto(cache, key, data);
        $rootScope.$broadcast(modelCachedEvent, key, cache[key]);
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

    function merge(data, targetObj) {
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

    function mergeInto(target, key, data) {
        if (!target[key]) {
            target[key] = data;
            return;
        }

        if (target[key] === data) {
            return;
        }

        var targetObj = target[key];
        merge(data, targetObj);
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

    function execFilter(arr, fn) {
        if (!angular.isArray(arr) || !angular.isFunction(fn)) {
            return arr;
        }

        var result = [];
        var l = arr.length;
        for (var i = 0 ; i < l ; i++) {
            if (fn(arr[i])) {
                result.push(arr[i]);
            }
        }
        return result;
    }

    function mkToScopeMethod(promise, key, cloned, idField) {
        cloned = !!cloned;
        promise.toScope = function (scope, field, filterFn) {
            if (cache[key]) {
                var obj = execFilter(cache[key], filterFn);
                updateScope(scope, field, cloned ? clone(obj) : obj, idField);
            }

            promise.then(function (result) {
                updateScope(scope, field, execFilter(result, filterFn), idField);

                // if a cloned version is requested, we don't want to do updates
                if (!cloned && angular.isArray(result) && angular.isFunction(filterFn)) {
                    scope.$on(modelCachedEvent, function (event, cacheKey, cacheObj) {
                        if (key === cacheKey) {
                            updateScope(scope, field, execFilter(cacheObj, filterFn), idField);
                        }
                    });
                }

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

    function getAll(Class, options, extra) {
        var opts = getOptions(Class, options, extra);
        var key = opts.ns;
        var cloned = !!opts.cloned;
        var promise = null;

        if (opts.useCached && cache[key]) {
            promise = mkResolved(cloned ? clone(cache[key]) : cache[key]);
        } else {
            promise = opts.backend("GET", key, null, "getAll").then(function (data) {
                fillCache(Class, opts, key, data);
                return cloned ? clone(cache[key]) : cache[key];
            });
        }

        mkToScopeMethod(promise, key, cloned);
        return promise;
    }

    function get(Class, options, id, extra) {
        var opts = getOptions(Class, options, extra);
        var key = opts.ns + "/" + id;
        var cloned = !!opts.cloned;
        var promise = null;

        if (opts.useCached && opts.useCachedChildren && cache[key]) {
            promise = mkResolved(cloned ? clone(cache[key]) : cache[key]);
        } else {
            promise = opts.backend("GET", key, null, "get").then(function (result) {
                fillCache(Class, opts, key, result);
                return cloned ? clone(cache[key]) : cache[key];
            });
        }

        mkToScopeMethod(promise, key, cloned, opts.idField);
        return promise;
    }

    function getAllSync(Class, options) {
        var opts = getOptions(Class, options);
        if (!opts.useCached) {
            throw new Error("Can only use getAllSync on models that have useCached: true");
        }
        var key = opts.ns;
        return cache[key];
    }

    function getSync(Class, options, id) {
        var opts = getOptions(Class, options);
        if (!opts.useCached) {
            throw new Error("Can only use getSync on models that have useCached: true");
        }
        var key = opts.ns + "/" + id;
        return cache[key];
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
        var promise = opts.backend("PUT", key, data, "update").then(function (result) {
            var newObj = newInstance(Class, result);
            storeInCache(key, newObj);
            merge(newObj, obj);
            delete obj[snapshotField];
            return cache[key];
        });

        mkToScopeMethod(promise, key);

        emit("Update", obj, promise);

        return promise;
    }

    function destroy(Class, options, obj) {
        var opts = getOptions(Class, options);
        var id = typeof obj === "object" ? obj[opts.idField] : obj;
        var key = opts.ns + "/" + id;

        var promise = opts.backend("DELETE", key, null, "destroy").then(function () {
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

                $rootScope.$broadcast(modelCachedEvent, opts.ns, parentColl);
            }
        });

        emit("Delete", obj, promise);

        return promise;
    }

    function create(Class, options, obj) {
        var opts = getOptions(Class, options);
        obj = obj.constructor === Class ? obj : newInstance(Class, obj);
        var promise = opts.backend("POST", opts.ns, obj, "create").then(function (data) {
            var newObj = newInstance(Class, data);
            var key = opts.ns + "/" + newObj[opts.idField];
            storeInCache(key, newObj);
            var result = cache[key];

            merge(result, obj);
            obj[cloneParent] = result;
            delete obj[snapshotField];

            // Add to parent collection (if available)
            var parentColl = cache[opts.ns];
            if (parentColl) {
                var found = false;
                for (var i = 0; i < parentColl.length; i++) {
                    if (parentColl[i][opts.idField] === newObj[opts.idField]) {
                        found = true;
                    }
                }

                if (!found) {
                    parentColl.push(result);
                }

                $rootScope.$broadcast(modelCachedEvent, opts.ns, parentColl);
            }

            return result;
        });

        emit("Create", obj, promise);

        return promise;
    }

    function save() {
        var self = this;
        var options = self.constructor.modelOptions;

        var hasSnapshot = !!self[snapshotField];

        var promise = null;
        if (!self[options.idField]) {
            promise = self.create();
        } else {
            promise = self.update();
        }

        emit("Save", self, promise);

        if (hasSnapshot) {
            return promise.then(function (r) {
                self.snapshot();
                return r;
            });
        } else {
            return promise;
        }
    }

    function hasChanges() {
        var options = this.constructor.modelOptions;
        var base = {};

        if (!this[options.idField]) {
            // new object
            if (this[snapshotField]) {
                base = this[snapshotField];
            }
        } else {
            // existing object
            if (!this[cloneParent]) {
                throw new Error("Only works on clones!");
            }

            base = this[cloneParent];
            if (this[snapshotField]) {
                base = this[snapshotField];
            }
        }

        // Comparing to a clone ensures that we take any custom
        // toJSON implementations into account.
        return !angular.equals(clone(this), base);
    }

    function snapshot() {
        var options = this.constructor.modelOptions;

        if (this[options.idField] && !this[cloneParent]) {
            throw new Error("Only works on clones!");
        }

        this[snapshotField] = clone(this);
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
            cls.getAllSync = staticMethod(cls, getAllSync);
            cls.getSync = staticMethod(cls, getSync);
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
            proto.snapshot = snapshot;
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

        mkToScope: mkToScopeMethod,
    };

    return Model;
});
