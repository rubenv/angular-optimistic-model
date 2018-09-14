describe("Model", function () {
    var $q;
    var $httpBackend;
    var $interval;
    var $rootScope;
    var Model = null;
    var Person;
    var callAccount;

    function onlyPersonsWithR(person) {
        return person.first_name.indexOf("R") === 0;
    }

    beforeEach(module("rt.optimisticmodel"));

    beforeEach(inject(function ($injector, $http) {
        $httpBackend = $injector.get("$httpBackend");
        $interval = $injector.get("$interval");
        $q = $injector.get("$q");
        $rootScope = $injector.get("$rootScope");

        callAccount = function callAccount(method, url, data) {
            return $http({
                method: method,
                url: url,
                data: data,
            }).then(function (result) { return result.data; });
        };

        Model = $injector.get("Model");
        Model.defaults({
            backend: callAccount
        });

        Person = function Person() {
        };

        Model.extend(Person, {
            ns: "/api/people"
        });

        Person.prototype.getFullName = function () {
            return this.first_name + " " + this.last_name;
        };
    }));

    afterEach(function () {
        $httpBackend.verifyNoOutstandingExpectation();
        $httpBackend.verifyNoOutstandingRequest();
    });

    it("Has an extend method", function () {
        assert.isFunction(Model.extend);
        assert.equal(Person.modelOptions.ns, "/api/people");
    });

    it("Has a defaults method", function () {
        assert.isFunction(Model.defaults);
        assert.equal(Person.modelOptions.backend, callAccount);
    });

    it("Has a static getAll method", function () {
        assert.isFunction(Person.getAll);
    });

    it("Has a static get method", function () {
        assert.isFunction(Person.get);
    });

    it("getAll fetches all models from the backend", function () {
        var called = false;
        Person.getAll().then(function (people) {
            called = true;
            assert.equal(people.length, 1);
            assert.equal(people[0].constructor, Person);
            assert.equal(people[0].id, 123);
            assert.equal(people[0].first_name, "Ruben");
        });
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" }
        ]);
        $httpBackend.flush();
        assert(called);
    });

    it("toScope: Scope gets pre-filled if we already have a cached copy", function () {
        // Fill cache
        Person.getAll();
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" }
        ]);
        $httpBackend.flush();

        // Request it again somewhere else
        var scope = {};
        Person.getAll().toScope(scope, "people");

        // Should be on scope now
        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");

        // Scope gets updated when results come in
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 124, first_name: "Joe" }
        ]);
        $httpBackend.flush();
        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 124);
        assert.equal(scope.people[0].first_name, "Joe");
    });

    it("toScope: Updates scope objects in place", function () {
        var result = null;
        Person.get(123).then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Ruben" });
        $httpBackend.flush();

        var scope = {};
        var result2 = null;
        Person.get(123).toScope(scope, "person").then(function (obj) {
            result2 = obj;
        });
        assert.equal(scope.person.first_name, "Ruben");
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Joe" });
        $httpBackend.flush();

        assert.equal(scope.person.id, 123);
        assert.equal(scope.person.first_name, "Joe");
        assert.equal(scope.person.constructor, Person);
        assert.equal(scope.person, result);
        assert.equal(result2, result);
    });

    it("toScope: Updates scope arrays in place", function () {
        // Fill cache
        var result = null;
        Person.getAll().then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Joe" }
        ]);
        $httpBackend.flush();

        // Fetch array
        var scope = {};
        var result2 = null;
        Person.getAll().toScope(scope, "people").then(function (obj) {
            result2 = obj;
            assert.equal(result2, result);
        });
        assert.equal(scope.people, result);
        assert.equal(scope.people[0].first_name, "Ruben");

        // Respond to call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Bart" },
            { id: 124, first_name: "Alice" }
        ]);
        $httpBackend.flush();

        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Bart");
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people, result);
        assert.equal(result2, result);
    });

    it("toScope: Uses results from getAll to pre-populate get", function () {
        // Fill cache
        Person.getAll();
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Joe" }
        ]);
        $httpBackend.flush();

        // Do GET
        var scope = {};
        var result = null;
        Person.get(123).toScope(scope, "person").then(function (obj) {
            result = obj;
        });
        assert.equal(scope.person.first_name, "Ruben");

        // Update with real result
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "New" });
        $httpBackend.flush();

        assert.equal(result.first_name, "New");
        assert.equal(scope.person, result);
    });

    it("toScope: Scope gets pre-filled if we already have cached copy (+filter)", function () {
        // Fill cache
        Person.getAll();
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Kim" }
        ]);
        $httpBackend.flush();

        // Request it again somewhere else
        var scope = $rootScope.$new();
        Person.getAll().toScope(scope, "people", onlyPersonsWithR);

        // Should be on scope now
        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");

        // Scope gets updated when results come in
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 124, first_name: "Joe" },
            { id: 125, first_name: "Ron" }
        ]);
        $httpBackend.flush();
        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 125);
        assert.equal(scope.people[0].first_name, "Ron");
    });

    it("toScope: Updates scope arrays in place (+filter)", function () {
        // Fill cache
        var result = null;
        Person.getAll().then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Joe" }
        ]);
        $httpBackend.flush();

        // Fetch array
        var scope = $rootScope.$new();
        var result2 = null;
        Person.getAll().toScope(scope, "people", onlyPersonsWithR).then(function (obj) {
            result2 = obj;
            assert.equal(result2.length, 1);
        });
        assert.equal(scope.people[0].first_name, "Ruben");

        // Respond to call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Bart" },
            { id: 124, first_name: "Ron" }
        ]);
        $httpBackend.flush();

        assert.equal(scope.people[0].id, 124);
        assert.equal(scope.people[0].first_name, "Ron");
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people, result2);
        assert.notEqual(result2, result);
    });

    it("Can disable pre-populate", function () {
        function Objects() {}

        Model.extend(Objects, {
            ns: "/api/objects",
            populateChildren: false
        });

        Objects.getAll();
        $httpBackend.expectGET("/api/objects").respond(200, [
            { id: 123, val: "Test" },
        ]);
        $httpBackend.flush();

        var scope = {};
        var result = null;
        Objects.get(123).toScope(scope, "obj").then(function (obj) {
            result = obj;
        });

        // Expect a cache miss
        assert.equal(scope.obj, undefined);

        // Update with real result
        $httpBackend.expectGET("/api/objects/123").respond(200, { id: 123, val: "New" });
        $httpBackend.flush();

        assert.equal(scope.obj.val, "New");
        assert.equal(scope.obj, result);
    });

    it("Supports toJSON", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents" });
        Document.prototype.toJSON = function () { return { body: "bogus" }; };

        var doc = new Document();
        doc.id = 2;
        doc.update();

        $httpBackend.expectPUT("/api/documents/2", { body: "bogus" }).respond(200);
        $httpBackend.flush();
    });

    it("Can update statically", function () {
        Person.update({ id: 3, first_name: "Test" });
        $httpBackend.expectPUT("/api/people/3", { id: 3, first_name: "Test" }).respond(200);
        $httpBackend.flush();
    });

    it("Can select update fields", function () {
        Person.update({ id: 3, first_name: "Test" }, ["first_name"]);
        $httpBackend.expectPUT("/api/people/3", { first_name: "Test" }).respond(200);
        $httpBackend.flush();
    });

    it("Can select update fields on object", function () {
        var joe = new Person();
        joe.id = 3;
        joe.first_name = "Test";
        joe.update(["first_name"]);
        $httpBackend.expectPUT("/api/people/3", { first_name: "Test" }).respond(200);
        $httpBackend.flush();
    });

    it("Supports fromJSON", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents" });
        Document.prototype.fromJSON = function (data) {
            this.body = data.body.toUpperCase();
        };

        var called = false;
        Document.get(123).then(function (doc) {
            called = true;
            assert.equal(doc.body, "BOGUS");
        });

        $httpBackend.expectGET("/api/documents/123").respond(200, { body: "bogus" });
        $httpBackend.flush();

        assert(called);
    });

    it("Has a clear method to wipe the cache", function () {
        assert.isFunction(Model.clear);
    });

    it("Can delete objects", function () {
        var joe = new Person();
        joe.id = 123;
        joe.delete();
        $httpBackend.expectDELETE("/api/people/123").respond(200);
        $httpBackend.flush();
    });

    it("Can delete objects (static)", function () {
        Person.delete({ id: 123 });
        $httpBackend.expectDELETE("/api/people/123").respond(200);
        $httpBackend.flush();
    });

    it("Can delete objects (by id)", function () {
        Person.delete(123);
        $httpBackend.expectDELETE("/api/people/123").respond(200);
        $httpBackend.flush();

        Person.delete("124");
        $httpBackend.expectDELETE("/api/people/124").respond(200);
        $httpBackend.flush();
    });

    it("Delete removes the object from the parent collection", function () {
        var scope = {};
        Person.getAll().toScope(scope, "people");
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Test" }
        ]);
        $httpBackend.flush();

        // Got loaded, delete it
        assert.equal(scope.people.length, 2);
        scope.people[1].delete();
        $httpBackend.expectDELETE("/api/people/124").respond(200);
        $httpBackend.flush();

        assert.equal(scope.people.length, 1);

        var scope2 = {};
        Person.getAll().toScope(scope2, "people");

        // Should be on scope now, before request loads
        assert.equal(scope2.people.length, 1);
        assert.equal(scope2.people[0].constructor, Person);
        assert.equal(scope2.people[0].id, 123);
        assert.equal(scope2.people[0].first_name, "Ruben");

        // Flush call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" }
        ]);
        $httpBackend.flush();
    });

    it("Delete removes the object from the parent collection, even with a filter", function () {
        var scope = $rootScope.$new();
        Person.getAll().toScope(scope, "people", onlyPersonsWithR);
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Test" },
            { id: 125, first_name: "Ron" },
            { id: 126, first_name: "Kim" }
        ]);
        $httpBackend.flush();

        // Got loaded, delete it
        assert.equal(scope.people.length, 2);
        scope.people[1].delete();
        $httpBackend.expectDELETE("/api/people/125").respond(200);
        $httpBackend.flush();

        assert.equal(scope.people.length, 1);

        var scope2 = $rootScope.$new();
        Person.getAll().toScope(scope2, "people", onlyPersonsWithR);

        // Should be on scope now, before request loads
        assert.equal(scope2.people.length, 1);
        assert.equal(scope2.people[0].constructor, Person);
        assert.equal(scope2.people[0].id, 123);
        assert.equal(scope2.people[0].first_name, "Ruben");
        // Flush call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" }
        ]);
        $httpBackend.flush();
    });

    it("Delete removes the object from the parent collection (static)", function () {
        Person.getAll();
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Test" }
        ]);
        $httpBackend.flush();

        Person.delete(124);
        $httpBackend.expectDELETE("/api/people/124").respond(200);
        $httpBackend.flush();

        var scope = {};
        Person.getAll().toScope(scope, "people");

        // Should be on scope now, before request loads
        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");

        // Flush call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" }
        ]);
        $httpBackend.flush();
    });

    it("Delete removes the object from the parent collection (static) (+filter)", function () {
        Person.getAll();
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Test" },
            { id: 125, first_name: "Ron" },
            { id: 126, first_name: "Kim" }
        ]);
        $httpBackend.flush();

        Person.delete(124);
        $httpBackend.expectDELETE("/api/people/124").respond(200);
        $httpBackend.flush();

        var scope = $rootScope.$new();
        Person.getAll().toScope(scope, "people", onlyPersonsWithR);

        // Should be on scope now, before request loads
        assert.equal(scope.people.length, 2);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");
        assert.equal(scope.people[1].constructor, Person);
        assert.equal(scope.people[1].id, 125);
        assert.equal(scope.people[1].first_name, "Ron");

        // Flush call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 125, first_name: "Ron" },
            { id: 126, first_name: "Kim" }
        ]);
        $httpBackend.flush();


        Person.delete(125);
        $httpBackend.expectDELETE("/api/people/125").respond(200);
        $httpBackend.flush();

        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");
    });

    it("Can create objects", function () {
        var joe = new Person();
        joe.id = 123;
        joe.create();
        $httpBackend.expectPOST("/api/people", { id: 123 }).respond(200);
        $httpBackend.flush();
    });

    it("Can create objects (static)", function () {
        Person.create({ id: 123 });
        $httpBackend.expectPOST("/api/people", { id: 123 }).respond(200);
        $httpBackend.flush();
    });

    it("Create adds the object to the parent collection", function () {
        Person.getAll();
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" }
        ]);
        $httpBackend.flush();

        Person.create({ first_name: "Test" });
        $httpBackend.expectPOST("/api/people", { first_name: "Test" }).respond({
            id: 124,
            first_name: "Test"
        });
        $httpBackend.flush();

        var scope = {};
        Person.getAll().toScope(scope, "people");

        // Should be on scope now, before request loads
        assert.equal(scope.people.length, 2);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");
        assert.equal(scope.people[1].constructor, Person);
        assert.equal(scope.people[1].id, 124);
        assert.equal(scope.people[1].first_name, "Test");

        // Flush call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Test" }
        ]);
        $httpBackend.flush();
    });

    it("Create adds the object to the parent collection (+filter)", function () {
        var scope = $rootScope.$new();
        Person.getAll().toScope(scope, "people", onlyPersonsWithR);
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 124, first_name: "Test" }
        ]);
        $httpBackend.flush();

        // Should be on scope now, before request loads
        assert.equal(scope.people.length, 0);

        Person.create({ first_name: "Ruben" });
        $httpBackend.expectPOST("/api/people", { first_name: "Ruben" }).respond({
            id: 123,
            first_name: "Ruben"
        });
        $httpBackend.flush();

        // Should be on scope now, before request loads
        assert.equal(scope.people.length, 1);
        assert.equal(scope.people[0].constructor, Person);
        assert.equal(scope.people[0].id, 123);
        assert.equal(scope.people[0].first_name, "Ruben");

        var scope2 = $rootScope.$new();
        Person.getAll().toScope(scope2, "people", onlyPersonsWithR);

        // Should be on scope now, before request loads
        assert.equal(scope2.people.length, 1);
        assert.equal(scope2.people[0].constructor, Person);
        assert.equal(scope2.people[0].id, 123);
        assert.equal(scope2.people[0].first_name, "Ruben");

        // Flush call
        $httpBackend.expectGET("/api/people").respond(200, [
            { id: 123, first_name: "Ruben" },
            { id: 124, first_name: "Test" }
        ]);
        $httpBackend.flush();
    });

    it("Can pre-fill the cache", function () {
        Person.cache("/api/people/123", {
            id: 123,
            first_name: "Joe"
        });

        var scope = {};
        var result = null;
        Person.get(123).toScope(scope, "person").then(function (obj) {
            result = obj;
        });

        assert.equal(scope.person.first_name, "Joe");

        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
        assert.equal(scope.person.first_name, "Bob");
    });

    it("Saving a new object creates it", function () {
        var joe = new Person();
        joe.first_name = "Joe";
        joe.save();
        $httpBackend.expectPOST("/api/people", { first_name: "Joe" }).respond(200);
        $httpBackend.flush();
    });

    it("Updating an existing object updates it", function () {
        var joe = new Person();
        joe.id = 123;
        joe.first_name = "Joe";
        joe.save();
        $httpBackend.expectPUT("/api/people/123", { id: 123, first_name: "Joe" }).respond(200);
        $httpBackend.flush();
    });

    it("Can get a cloned version, which doesn\'t affect the cache", function () {
        var joe = null;
        Person.getClone(123).then(function (p) {
            joe = p;
            joe.first_name = "Joe";
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();

        var result = null;
        Person.get(123).then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
        assert.equal(result.first_name, "Bob");
        assert.equal(joe.first_name, "Joe");

        // Change shouldn't affect scope
        var scope = {};
        var result2 = null;
        Person.get(123).toScope(scope, "person").then(function (obj) {
            result2 = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
        assert.equal(result2.first_name, "Bob");
        assert.equal(scope.person.first_name, "Bob");

        // Clone doesn't get updated
        assert.equal(joe.first_name, "Joe");

        // Same thing, cached
        var joe2 = null;
        var scope2 = {};
        Person.getClone(123).toScope(scope2, "person").then(function (obj) {
            joe2 = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
        joe2.first_name = "Joe";
        assert.equal(joe2.first_name, "Joe");
        assert.equal(scope2.person.first_name, "Joe");

        // Cache should be unchanged
        var scope3 = {};
        Person.get(123).toScope(scope3, "person");
        assert.equal(scope3.person.first_name, "Bob");
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
    });

    it("Will not fetch cached data when using useCached", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: "test"
            }
        ]);

        var scope = {};
        var documents = null;
        Document.getAll().toScope(scope, "documents").then(function (result) {
            documents = result;
        });
        $rootScope.$digest();

        assert.equal(scope.documents, documents);
        assert.equal(scope.documents[0], documents[0]);
        assert.equal(scope.documents[0].constructor, Document);
        assert.equal(documents[0].content, "test");

        // Also works for get
        var scope2 = {};
        var doc = null;
        Document.get(123).toScope(scope2, "document").then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        assert.equal(scope2.document, doc);
        assert.equal(scope2.document.constructor, Document);
        assert.equal(doc.content, "test");
    });

    it("getCached does not fetch unless needed", function () {
        // Not cached, will fetch
        var result = null;
        Person.getCached(123).then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Ruben" });
        $httpBackend.flush();

        // Cached, won't fetch
        var scope = {};
        var result2 = null;
        Person.getCached(123).toScope(scope, "person").then(function (obj) {
            result2 = obj;
        });
        $rootScope.$digest();
        assert.equal(scope.person.first_name, "Ruben");
        assert.equal(scope.person, result);
        assert.equal(result2, result);
    });

    it("getCached always checks cache", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true, useCachedChildren: true });

        Document.cache("/api/documents/123", {
            id: 123,
            content: "test"
        });

        var scope = {};
        var doc = null;
        Document.get(123).toScope(scope, "document").then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        assert.equal(scope.document, doc);
        assert.equal(scope.document.constructor, Document);
        assert.equal(doc.content, "test");
    });

    it("Uses options from class, adds overrides", function () {
        Model.get(Person, { ns: "/api/test" }, 123);
        $httpBackend.expectGET("/api/test/123").respond(200);
        $httpBackend.flush();
    });

    it("Clones work with useCached", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: "test"
            }
        ]);

        var doc = null;
        Document.get(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();
        assert.equal(doc.content, "test");

        var clone = null;
        Document.getClone(123).then(function (result) {
            clone = result;
        });
        $rootScope.$digest();
        assert.equal(clone.content, "test");
        assert.equal(doc.content, "test");

        clone.content = "bla";
        assert.equal(clone.content, "bla");
        assert.equal(doc.content, "test");
    });

    it("Correctly clones deep data", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.get(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();
        assert.equal(doc.content.body, "test");

        var clone = null;
        Document.getClone(123).then(function (result) {
            clone = result;
        });
        $rootScope.$digest();
        assert.equal(clone.content.body, "test");
        assert.equal(doc.content.body, "test");

        clone.content.body = "bla";
        assert.equal(clone.content.body, "bla");
        assert.equal(doc.content.body, "test");
    });

    it("Can disable child caching", function () {
        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            useCached: true,
            useCachedChildren: false,
        });

        Document.cache("/api/documents", [
            {
                id: 123,
            }
        ]);

        // No call on getAll.
        Document.getAll();
        $rootScope.$digest();

        // Does fetch children.
        Document.get(123);
        $httpBackend.expectGET("/api/documents/123").respond(200, { id: 123 });
        $httpBackend.flush();
    });

    it("Will derive cache key from objects", function () {
        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            useCached: true,
        });

        Document.cache([
            {
                id: 123,
                title: "Test"
            }
        ]);

        Document.cache({
            id: 124,
            title: "Test 2"
        });

        // No call on getAll.
        var scope = {};
        Document.getAll().toScope(scope, "documents");
        $rootScope.$digest();

        // No call on get either.
        Document.get(124).toScope(scope, "document");
        $rootScope.$digest();

        assert.equal(scope.documents.length, 1);
        assert.equal(scope.documents[0].title, "Test");
        assert.equal(scope.document.title, "Test 2");
    });

    it("Ignores private fields", function () {
        function Document() {
            this._priv = 123;
            this.$priv2 = 124;
        }
        Model.extend(Document, {
            ns: "/api/documents",
            useCached: true,
        });

        Document.cache({
            id: 124,
            title: "Test 2"
        });

        var doc = Model.getCache("/api/documents/124");
        assert.equal(doc.constructor, Document);
        assert.equal(doc._priv, 123);
        assert.equal(doc.$priv2, 124);
        doc._priv = 456;
        doc.$priv2 = 457;


        Document.cache({
            id: 124,
            title: "Test 3"
        });

        assert.equal(doc.title, "Test 3");
        assert.equal(doc._priv, 456);
        assert.equal(doc.$priv2, 457);
    });

    it("Should not overwrite scope objects that are referenced elsewhere", function () {
        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            useCached: true,
        });

        Document.cache([
            {
                id: 123,
                title: "Test"
            },
            {
                id: 124,
                title: "Test 2"
            }
        ]);

        var scope = {};
        Document.get(123).toScope(scope, "document");
        $rootScope.$digest();

        var doc = scope.document;
        assert.equal(doc.id, 123);
        assert.equal(doc.title, "Test");

        // Load a different ID into the scope
        Document.get(124).toScope(scope, "document");
        $rootScope.$digest();

        assert.equal(scope.document.id, 124);
        assert.equal(scope.document.title, "Test 2");

        // Should leave original intact
        assert.equal(doc.id, 123);
        assert.equal(doc.title, "Test");
    });

    it("Can track changes on cloned objects", function () {

        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.getClone(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();
        assert.equal(doc.content.body, "test");
        assert.equal(doc.hasChanges(), false);

        doc.content.body = "bla";
        assert.equal(doc.hasChanges(), true);

        doc.content.body = "test";
        assert.equal(doc.hasChanges(), false);
    });

    it("Can get a cloned version for a complete collection", function () {
        var joe = null;
        var people = null;
        Person.getAll({ cloned: true }).then(function (p) {
            joe = p[0];
            joe.first_name = "Joe";

            people = p;
            people.push({ first_name: "Rick" });
        });
        $httpBackend.expectGET("/api/people").respond(200, [{ id: 123, first_name: "Bob" }]);
        $httpBackend.flush();

        var result = null;
        Person.get(123).then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
        assert.equal(result.first_name, "Bob");
        assert.equal(joe.first_name, "Joe");
        assert.equal(people.length, 2);

        var result2 = null;
        Person.getAll().then(function (p) {
            result2 = p;
        });
        $httpBackend.expectGET("/api/people").respond(200, [{ id: 123, first_name: "Bob" }]);
        $httpBackend.flush();
        assert.equal(result2.length, 1);
        assert.equal(people.length, 2);
    });

    it("Can get a cloned version for a complete collection (+filter)", function () {
        var joe = null;
        var people = null;
        var scope = $rootScope.$new();
        Person.getAll({ cloned: true }).toScope(scope, "persons", onlyPersonsWithR).then(function (p) {
            joe = p[0];
            joe.first_name = "Joe";

            people = p;
            people.push({ first_name: "Rick" });
        });
        $httpBackend.expectGET("/api/people").respond(200, [{ id: 123, first_name: "Ruben" }, { id: 124, first_name: "Jon" }]);
        $httpBackend.flush();

        var result = null;
        Person.get(123).then(function (obj) {
            result = obj;
        });
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Ruben" });
        $httpBackend.flush();
        assert.equal(result.first_name, "Ruben");
        assert.equal(joe.first_name, "Joe");
        assert.equal(people.length, 2);

        var result2 = null;
        Person.getAll().then(function (p) {
            result2 = p;
        });

        $httpBackend.expectGET("/api/people").respond(200, [{ id: 123, first_name: "Bob" }]);
        $httpBackend.flush();

        assert.equal(result2.length, 1);
        assert.equal(people.length, 2);
    });

    it("Resets hasChanges after saving a clone", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.getClone(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();
        assert.equal(doc.content.body, "test");
        assert.equal(doc.hasChanges(), false);

        doc.content.body = "bla";
        assert.equal(doc.hasChanges(), true);

        doc.save();
        $httpBackend.expectPUT("/api/documents/123", { id: 123, content: { body: "bla" } }).respond(200, { id: 123, content: { body: "bla" } });
        $httpBackend.flush();

        assert.equal(doc.hasChanges(), false);
    });

    it("Supports hasChanges on a new model", function () {
        var joe = new Person();
        assert.equal(joe.hasChanges(), false);

        joe.first_name = "Joe";
        assert.equal(joe.hasChanges(), true);

        joe.first_name = undefined;
        assert.equal(joe.hasChanges(), false);
    });

    it("Should support hasChanges on a new object even after it has been created and has an id", function () {
        var joe = new Person();
        joe.first_name = "Joe";

        joe.save();
        $httpBackend.expectPOST("/api/people", { first_name: "Joe" }).respond(200, { id: 123, first_name:"Joe" });
        $httpBackend.flush();

        assert.equal(joe.id, 123);

        joe.first_name = "Adam";
        assert.equal(joe.hasChanges(), true);

        joe.save();
        $httpBackend.expectPUT("/api/people/123", { id: 123, first_name: "Adam" }).respond(200, { id: 123, first_name:"Adam" });
        $httpBackend.flush();

        assert.equal(joe.hasChanges(), false);

    });

    it("Should store a clone of a new object in the cache", function () {
        var joe = new Person();
        joe.first_name = "Joe";

        joe.save();
        $httpBackend.expectPOST("/api/people", { first_name: "Joe" }).respond(200, { id: 123, first_name:"Joe" });
        $httpBackend.flush();

        assert.equal(joe.id, 123);

        joe.first_name = "Adam";

        var joeCache = Model.getCache("/api/people/123");
        assert.equal(joeCache.first_name, "Joe");
        assert.equal(joeCache.id, 123);

    });

    it("Should update the clone with the response from the server", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.getClone(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        doc.content.body = "awesome";
        doc.save();
        $httpBackend.expectPUT("/api/documents/123", { id: 123, content: { body: "awesome" } }).respond(200, { id: 123, content: { body: "awesome" }, generated: 1 });
        $httpBackend.flush();

        assert.equal(doc.generated, 1);
    });

    it("Should support storing a snapshot", function () {
        var joe = new Person();
        joe.first_name = "Joe";

        assert.equal(joe.hasChanges(), true);

        joe.snapshot();

        assert.equal(joe.hasChanges(), false);

        joe.first_name = "Adam";

        assert.equal(joe.hasChanges(), true);
    });

    it("Shouldn't support snapshotting on a regular object", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.get(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        assert.throw(function () { doc.snapshot(); });
    });

    it("Should support snapshotting on a clone", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.getClone(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        assert.equal(doc.hasChanges(), false);

        doc.content.body = "awesome";

        assert.equal(doc.hasChanges(), true);

        doc.snapshot();

        assert.equal(doc.hasChanges(), false);

    });

    it("Should support snapshotting together with a save", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.getClone(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        assert.equal(doc.hasChanges(), false);

        doc.content.body = "awesome";

        assert.equal(doc.hasChanges(), true);

        doc.snapshot();

        assert.equal(doc.hasChanges(), false);

        doc.save();
        $httpBackend.expectPUT("/api/documents/123", { id: 123, content: { body: "awesome" } }).respond(200, { id: 123, content: { body: "awesome" }, generated: 1 });
        $httpBackend.flush();

        assert.equal(doc.generated, 1);
        assert.equal(doc.hasChanges(), false);
    });

    it("Snapshot tracking should stay active when saving", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: {
                    body: "test"
                }
            }
        ]);

        var doc = null;
        Document.getClone(123).then(function (result) {
            doc = result;
        });
        $rootScope.$digest();

        assert.equal(doc.hasChanges(), false);

        doc.content.body = "awesome";

        assert.equal(doc.hasChanges(), true);

        doc.snapshot();

        assert.equal(doc.hasChanges(), false);

        doc.save();
        $httpBackend.expectPUT("/api/documents/123", { id: 123, content: { body: "awesome" } }).respond(200, { id: 123, content: { body: "awesome" } });
        $httpBackend.flush();

        assert.equal(doc.hasChanges(), false);
        doc.content.body = "new";
        assert.equal(doc.hasChanges(), true);
    });

    it("Can use getAllSync on cached models", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: "test"
            }
        ]);

        var docs = Document.getAllSync();
        assert.equal(docs.length, 1);
        assert.equal(docs[0].content, "test");

        // Also works dereferenced
        var fn = Document.getAllSync;
        var docs2 = fn();
        assert.equal(docs, docs2);
    });

    it("Cannot use getAllSync unless the model has useCached: true", function () {
        assert.throw(function () { Person.getAllSync(); });
    });

    it("Can use getSync on cached models", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents", useCached: true });

        Document.cache("/api/documents", [
            {
                id: 123,
                content: "test"
            }
        ]);

        var doc = Document.getSync(123);
        assert.equal(doc.content, "test");

        // Also works dereferenced
        var fn = Document.getSync;
        var doc2 = fn(123);
        assert.equal(doc, doc2);
    });

    it("Cannot use getSync unless the model has useCached: true", function () {
        assert.throw(function () { Person.getSync(123); });
    });

    it("Can register custom backend", function () {
        var lastOperation = null;

        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            backend: function (method, url, data, operation) {
                assert.equal(method, "GET");
                assert.equal(url, "/api/documents");
                assert.equal(data, null);
                lastOperation = operation;

                var deferred = $q.defer();
                deferred.resolve();
                return deferred.promise;
            },
        });

        Document.getAll();

        // Receives operation
        assert.equal(lastOperation, "getAll");
    });

    it("Correctly passes options to cache", function () {
        var result = [
            { id: 123 },
        ];

        function Document() {}
        Model.extend(Document, {
            backend: function () {
                var deferred = $q.defer();
                deferred.resolve(result);
                return deferred.promise;
            },
        });

        Document.getAll({ ns: "test", useCached: true, populateChildren: false });
        $rootScope.$digest();

        assert.isArray(Model.getCache("test"));
        assert.equal(Model.getCache("test/123"), undefined);
    });

    it("Custom toJSON should not affect hasChanges", function () {
        function Document() {}
        Model.extend(Document);

        var doc = new Document();
        doc.a = 1;
        doc.b = 2;

        doc.snapshot();
        assert.equal(doc.hasChanges(), false);

        // Also works with custom toJSON.
        Document.prototype.toJSON = function () { return { a: this.a }; };

        doc.snapshot();
        assert.equal(doc.hasChanges(), false);
    });

    it("Supports query arguments to getAll()", function () {
        var lastOperation = null;

        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            backend: function (method, url, data, operation) {
                assert.equal(method, "GET");
                assert.equal(url, "/api/documents?filter=a%20filter&limit=10");
                assert.equal(data, null);
                lastOperation = operation;

                var deferred = $q.defer();
                deferred.resolve([
                    {
                        id: 123
                    }
                ]);
                return deferred.promise;
            },
            useCached: true,
        });

        var query = {
            limit: 10,
            filter: "a filter",
        };

        Document.getAll({ query: query });
        $rootScope.$digest();

        // Receives operation
        assert.equal(lastOperation, "getAll");

        // Should cache correctly
        var result = Document.getAllSync({ query: query });
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 123);
    });

    it("Has a self parameter that points to the calling object", function () {
        var selfObj = null;
        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            backend: function (method, url, data, operation, self) {
                selfObj = self;
                var deferred = $q.defer();
                deferred.resolve();
                return deferred.promise;
            },
        });

        var doc = new Document();
        doc.create();
        $rootScope.$digest();
        assert.equal(selfObj, doc);
    });

    it("Keeps private data after saving", function () {
        function Document() {
            this.$$private = 0;
        }
        Model.extend(Document, {
            ns: "/api/documents",
            backend: function (method, url, data, operation, self) {
                assert.equal(self.$$private, 1);
                var deferred = $q.defer();
                deferred.resolve({
                    id: 1,
                });
                return deferred.promise;
            },
        });

        var doc = new Document();
        doc.$$private = 1;
        doc.save();
        $rootScope.$digest();
        assert.equal(doc.$$private, 1);
    });

    it("Can set max cache lifetime", function () {
        var now = new Date().getTime();
        function Document() {}
        Model.extend(Document, {
            ns: "/api/documents",
            useCached: true,
            cacheLife: 300,
        });

        var getTime = Model.now;
        Model.now = function () {
            return now;
        };

        Document.cache("/api/documents", [
            {
                id: 123,
                content: "test"
            }
        ]);

        var doc = Document.getSync(123);
        assert.equal(doc.content, "test");

        Model.now = function () {
            return now + 310 * 1000;
        };
        $interval.flush(310 * 1000);

        doc = Document.getSync(123);
        assert.equal(doc, null);

        Model.now = getTime;
    });

    it("Objects have a clone method", function () {
        function Document() {}
        Model.extend(Document, { ns: "/api/documents" });

        var doc = new Document();
        doc.id = 2;

        var clone = doc.clone();
        assert.equal(clone.hasChanges(), false);
        clone.id = 3;
        assert.equal(clone.hasChanges(), true);
        assert.equal(doc.id, 2);
        assert.equal(clone.id, 3);
    });

    it ("Behaves with regards to constructor", function () {
        function Document() {
            this.val = 1;
        }
        Model.extend(Document, { ns: "/api/documents" });

        Document.cache("/api/documents/123", {
            id: 123,
            val: 2
        });

        var result = null;
        Document.getCached(123).then(function (obj) {
            result = obj;
            assert.equal(result.val, 2);
        });
        $rootScope.$digest();

        assert.equal(result.val, 2);
    });

    it("Cloned versions are always refreshed from the network", function () {
        var scope = {};
        Person.get(123).toScope(scope, "person");
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Bob" });
        $httpBackend.flush();
        assert.equal(scope.person.first_name, "Bob");

        var p1 = null;
        Person.getClone(123).toScope(scope, "cloned").then(function (p) {
            p1 = p;
        });
        assert.equal(p1, null);
        assert.equal(scope.cloned, null);
        $httpBackend.expectGET("/api/people/123").respond(200, { id: 123, first_name: "Joe" });
        $httpBackend.flush();
        assert.equal(scope.cloned.first_name, "Joe");
        assert.equal(false, scope.cloned.hasChanges());
    });
});
