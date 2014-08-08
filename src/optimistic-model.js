angular.module('rt.optimisticmodel', []).factory('Model', function ($q, $rootScope) {
    var defaultOptions = {
        idField: 'id',
        populateChildren: true,
        useCached: false
    };

    var cache = {};

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
    }

    function fillCache(key, data) {
        var options = this.modelOptions;
        if (angular.isArray(data)) {
            var results = [];
            for (var i = 0; i < data.length; i++) {
                var obj = newInstance(this, data[i]);
                if (options.populateChildren) {
                    storeInCache(key + '/' + obj[options.idField], obj);
                }
                results.push(obj);
            }
            storeInCache(key, results);
        } else {
            storeInCache(key, newInstance(this, data));
        }
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

    function getAll() {
        var self = this;
        var options = self.modelOptions;
        var key = options.ns;
        var promise = null;

        if (options.useCached && cache[key]) {
            promise = mkResolved(cache[key]);
        } else {
            promise = options.backend('GET', key).then(function (data) {
                fillCache.call(self, key, data);
                return cache[key];
            });
        }

        mkToScopeMethod(promise, key);
        return promise;
    }

    function get(id, cloned) {
        var self = this;
        cloned = !!cloned;
        var options = self.modelOptions;
        var key = options.ns + '/' + id;
        var promise = null;

        if (options.useCached && cache[key]) {
            promise = mkResolved(cache[key]);
        } else {
            promise = options.backend('GET', key).then(function (result) {
                fillCache.call(self, key, result);
                return cloned ? clone(cache[key]) : cache[key];
            });
        }

        mkToScopeMethod(promise, key, cloned);
        return promise;
    }

    function getClone(id) {
        return this.get(id, true);
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
        var self = this;
        var options = self.constructor.modelOptions;

        $rootScope.$broadcast('modelSaveStarted', self);

        var promise = null;
        if (!self[options.idField]) {
            promise = self.create();
        } else {
            promise = self.update();
        }

        promise.finally(function () {
            $rootScope.$broadcast('modelSaveEnded', self);
        });

        return promise;
    }

    var Model = {
        defaults: function (defaults) {
            defaultOptions = angular.extend(defaultOptions, defaults);
        },

        extend: function (cls, options) {
            cls.getAll = getAll;
            cls.get = get;
            cls.getClone = getClone;
            cls.update = update;
            cls.delete = destroy;
            cls.create = create;
            cls.cache = fillCache;
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

        getCache: function (key) {
            return cache[key];
        }
    };

    return Model;
});
