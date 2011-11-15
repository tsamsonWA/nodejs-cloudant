/* minimal couch in node
 *
 * copyright 2011 nuno job <nunojob.com> (oO)--',--
 *
 * licensed under the apache license, version 2.0 (the "license");
 * you may not use this file except in compliance with the license.
 * you may obtain a copy of the license at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * unless required by applicable law or agreed to in writing, software
 * distributed under the license is distributed on an "as is" basis,
 * without warranties or conditions of any kind, either express or implied.
 * see the license for the specific language governing permissions and
 * limitations under the license.
 */
(function() {
  var root          = this
    , previous_nano = root.nano
    , default_url   = "http://localhost:5984"
    , nano
    ;

/*
 * nano is a library that helps you building requests to couchdb
 * that is built on top of mikeals/request
 *
 * no more, no less
 * be creative. be silly. have fun! relax!
 *
 * dinosaurs spaceships!
 */
nano = function database_module(cfg) {
  var public_functions = {}, path, db;

  // find out if we are in verbose mode
  if (cfg && cfg.verbose) { nano.fn.set_verbose(cfg.verbose); }
  // string gets converted into a uri if file couldn't be required (nodejs)
  // objects are left alone
  // if uri is missing after all of this we add default_uri and console.error
  //   the error  
  cfg  = nano.fn.check_cfg(cfg);

  // use proxy if the user requests so, nodejs only
  if (cfg.proxy)   { nano.fn.set_proxy(cfg.proxy); }

  // log the configuration file if we are in testing mode
  nano.fn.verbose(cfg);
  
  // parse the url
  // this allow us to discover if the user is looking for a nano object
  // or a database object, e.g. http://somehostname.org/database would yield
  // a database object
  path = nano.fn.url_parse(cfg.url);

 /****************************************************************************
  * relax                                                                    *
  ***************************************************************************/
 /*
  * relax
  *
  * base for all request using nano
  * this function assumes familiarity with the couchdb api
  *
  * e.g.
  * nano.request( { db: "alice"
  *               , doc: "rabbit"
  *               , method: "GET"
  *               , params: { rev: "1-967a00dff5e02add41819138abb3284d"}
  *               },
  *   function (_,b) { console.log(b) });
  *
  * @error {request:socket} problem connecting to couchdb
  * @error {couch:*} an error proxied from couchdb
  *
  * @param {opts:object} request options; e.g. {db: "test", method: "GET"}
  *        {opts.db:string} database name
  *        {opts.method:string:optional} http method, defaults to "GET"
  *        {opts.path:string:optional} a full path, override `doc` and `att`
  *        {opts.doc:string:optional} document name
  *        {opts.att:string:optional} attachment name
  *        {opts.content_type:string:optional} content type, default to json
  *        {opts.body:object|string|binary:optional} document or 
  *          attachment body
  *        {opts.encoding:string:optional} encoding for attachments
  * @param {callback:function:optional} function to call back
  */
  function relax(opts,callback) {
    try {
      var headers = { "content-type": "application/json"
                    , "accept": "application/json"
                    }
        , req     = { method: (opts.method || "GET"), headers: headers
                    , uri: cfg.url + "/" + opts.db }
        , params  = opts.params
        , status_code
        , parsed
        , rh
        ;
      // if there's a path simply use it
      if(opts.path) { req.uri += "/" + opts.path; }
      // else if there is a doc
      else if(opts.doc)  {
        // and its not a design document
        if(!/^_design/.test(opts.doc)) {
          // add the encoded uri component to the uri
          req.uri += "/" + encodeURIComponent(opts.doc);
        }
        // design documents dont get uri encoded
        else {
          req.uri += "/" + opts.doc;
        }
        // finally if there's an attachment add it to the uri
        if(opts.att) { req.uri += "/" + opts.att; }
      }
      // extra steps for encodings, excludes pipe cause pipe handles
      // this for us
      if(opts.encoding && callback) {
        // set the encoding
        req.encoding = opts.encoding;
        // undo headers set on the top
        delete req.headers["content-type"];
        delete req.headers.accept;
      }
      // if content type was provided
      if(opts.content_type) {
        // set the content type
        req.headers["content-type"] = opts.content_type;
        // undo headers set on the top
        delete req.headers.accept;
      }
      // cookie support is in review
      if(cfg.cookie){ req.headers.cookie = cfg.cookie; }
      if(!nano.fn.is_empty(params)) {
        ['startkey', 'endkey', 'key'].forEach(function (key) {
          if (key in params) {
            params[key] = nano.fn.JSON.stringify(params[key]);
          }
        });
        // add uri encoded params to the uri
        req.uri += "?" + nano.fn.qs_encode(params);
      }
      // no callback, pipe. browser, no callback? fu -- for now
      if(!callback) { return nano.fn.request(req); }
      if(opts.body) { nano.fn.set_body(req,opts.body); }
      // log the request if we are in verbose mode
      nano.fn.verbose(req);
      // do our request
      nano.fn.request(req, function(e,h,b) {
        rh = (h && h.headers || {});
        rh['status-code'] = status_code = (h && h.statusCode || 500);
        // socket error if connection couldn't be established
        if(e) { 
          return callback(nano.err.request(e,"socket",req,status_code),b,rh);
        }
        // prevent security exploits against couchdb
        delete rh.server;
        // some bugs were setting content-length + 1 in couch, this fixes it
        delete rh['content-length'];
        // try to get the body, json if possible, else just raw body
        try { parsed = nano.fn.JSON.parse(b); } catch (err) { parsed = b; }
        // 200 status codes means no error
        if (status_code >= 200 && status_code < 300) {
          // set cookie, in review...
          if (rh['set-cookie']){ cfg.cookie = rh['set-cookie']; }
          // respond to the user
          callback(null,parsed,rh);
        }
        else { // proxy the error directly from couchdb
          // verbose log the error
          nano.fn.verbose(parsed);
          callback(
            nano.err.couch(parsed.reason,parsed.error,req,status_code),
            parsed,rh);
        }
      });
    } catch(exc) {
      if (callback) {
        callback(nano.err.uncaught(exc));
      }
      else {
        nano.fn.error(exc);
      }
    }
  }

 /****************************************************************************
  * db                                                                       *
  ***************************************************************************/
 /*
  * creates a couchdb database
  * http://wiki.apache.org/couchdb/HTTP_database_API
  *
  * e.g. function recursive_retries_create_db(tried,callback) {
  *        nano.db.create(db_name, function (e,b) {
  *          if(tried.tried === tried.max_retries) {
  *            callback("Retries work");
  *            return;
  *          }
  *          else {
  *            tried.tried += 1;
  *            recursive_retries_create_db(tried,callback);
  *          }
  *        });
  *      }
  *
  * @param {db_name:string} database name
  *
  * @see relax
  */
  function create_db(db_name, callback) {
    return relax({db: db_name, method: "PUT"},callback);
  }

 /*
  * annihilates a couchdb database
  *
  * e.g. nano.db.destroy(db_name);
  *
  * even though this examples looks sync it is an async function
  *
  * @param {db_name:string} database name
  *
  * @see relax
  */
  function destroy_db(db_name, callback) {
    return relax({db: db_name, method: "DELETE"},callback);
  }

 /*
  * gets information about a couchdb database
  *
  * e.g. nano.db.get(db_name, function(e,b) {
  *        console.log(b);
  *      });
  *
  * @param {db_name:string} database name
  *
  * @see relax
  */
  function get_db(db_name, callback) {
    return relax({db: db_name, method: "GET"},callback);
  }

 /*
  * lists all the databases in couchdb
  *
  * e.g. nano.db.list(function(e,b) {
  *        console.log(b);
  *      });
  *
  * @see relax
  */
  function list_dbs(callback) {
    return relax({db: "_all_dbs", method: "GET"},callback);
  }

 /*
  * compacts a couchdb database
  *
  * e.g. nano.db.compact(db_name);
  *
  * @param {db_name:string} database name
  * @param {design_name:string:optional} design document name
  *
  * @see relax
  */
  function compact_db(db_name, design_name, callback) {
    if(typeof design_name === "function") {
      callback = design_name;
      design_name = null;
    }
    return relax(
      { db: db_name, path: ("_compact" + design_name)
      , method: "POST" },callback);
  }

 /*
  * couchdb database _changes feed
  *
  * e.g. nano.db.changes(db_name, {since: 2}, function (e,r,h) {
  *        console.log(r);
  *      });
  *
  * @param {db_name:string} database name
  * @param {params:object:optional} additions to the querystring
  *
  * @see relax
  */
  function changes_db(db_name, params, callback) {
    if(typeof params === "function") {
      callback = params;
      params = {};
    }
    return relax(
      { db: db_name, path: "_changes", params: params
      , method: "GET"},callback);
  }

 /*
  * replicates a couchdb database
  *
  * e.g. nano.db.replicate(db_1, db_2);
  *
  * @param {source:string} name of the source database
  * @param {target:string} name of the target database
  * @param {continuous:bool:optional} continuous replication on?
  *
  * @see relax
  */
  function replicate_db(source, target, continuous, callback) {
    if(typeof continuous === "function") {
      callback   = continuous;
      continuous = false;
    }
    var body = {source: source, target: target};
    if(continuous) { body.continuous = true; }
    return relax({db: "_replicate", body: body, method: "POST"},callback);
  }
  
 /****************************************************************************
  * session                                                                  *
  ***************************************************************************/
 /*
  * creates session
  *
  * e.g. nano.session.create(user, password)
  *
  * @param {user:string} user name
  * @param {pass:string} password
  *
  * @see relax
  */
  function create_session(user, password, callback) {
    var body = nano.fn.buffer("name=" + user + "&password=" + password);
    return relax(
      { db: "_session", body: body, method: "POST"
      , content_type: "application/x-www-form-urlencodeddata" }, callback);
  }

  /*
   * destroy session
   *
   * e.g. nano.session.destroy()
   *
   * @see relax
   */
   function destroy_session(callback) {
     cfg.cookie = null;  //make sure cookie gets destroyed also if error
     return relax({db: "_session", method: "DELETE"}, callback);
   }

 /****************************************************************************
  * doc                                                                      *
  ***************************************************************************/
  function document_module(db_name) {
    var public_functions = {};

   /*
    * inserts a document in a couchdb database
    * http://wiki.apache.org/couchdb/HTTP_Document_API
    *
    * @param {doc:object|string} document body
    * @param {doc_name:string:optional} document name
    *
    * @see relax
    */
    function insert_doc(doc,doc_name,callback) {
      var opts = {db: db_name, body: doc, method: "POST"};
      if(doc_name) {
        if(typeof doc_name === "function") {
          callback = doc_name;
        }
        else {
          opts.doc = doc_name;
          opts.method = "PUT";
        }
      }
      return relax(opts,callback);
    }

   /*
    * destroy a document from a couchdb database
    *
    * @param {doc_name:string} document name
    * @param {rev:string} previous document revision
    *
    * @see relax
    */
    function destroy_doc(doc_name,rev,callback) {
      return relax(
        { db: db_name, doc: doc_name, method: "DELETE"
        , params: {rev: rev} }, callback);
    }

   /*
    * get a document from a couchdb database
    *
    * e.g. db2.get("foo", {revs_info: true}, function (e,b,h) {
    *        console.log(e,b,h);
    *        return;
    *      });
    *
    * @param {doc_name:string} document name
    * @param {params:object:optional} additions to the querystring
    *
    * @see relax
    */
    function get_doc(doc_name,params,callback) {
      if(typeof params === "function") {
        callback = params;
        params   = {};
      }
      return relax(
        { db: db_name, doc: doc_name, method: "GET"
        , params: params },callback);
    }

   /*
    * lists all the documents in a couchdb database
    *
    * @param {params:object:optional} additions to the querystring
    *
    * @see get_doc
    * @see relax
    */
    function list_docs(params,callback) {
      if(typeof params === "function") {
        callback = params;
        params   = {};
      }
      return relax(
        { db: db_name, path: "_all_docs", method: "GET"
        , params: params } ,callback);
    }

   /*
    * calls a view
    *
    * @param {design_name:string} design document name
    * @param {view_name:string} view to call
    * @param {params:object:optional} additions to the querystring
    *
    * @see relax
    */
    function view_docs(design_name,view_name,params,callback) {
      if(typeof params === "function") {
        callback = params;
        params   = {};
      }
      var view_path = '_design/' + design_name + '/_view/'  + view_name;
      if (params.keys) {
        var body = {keys: params.keys};
        delete params.keys;
        return relax({db: db_name, path: view_path
                     , method: "POST", params: params, body: body}, callback);
      }
      else {
        return relax({db: db_name, path: view_path
                     , method: "GET", params: params},callback);
      }
    }

   /*
    * bulk update/delete/insert functionality
    * [1]: http://wiki.apache.org/couchdb/HTTP_Bulk_Document_API
    *
    * @param {docs:object} documents as per the couchdb api[1]
    *
    * @see get_doc
    * @see relax
    */
    function bulk_docs(docs,callback) {
      return relax(
        { db: db_name, path: "_bulk_docs", body: docs
        , method: "POST" },callback);
    }

   /**************************************************************************
    * attachment                                                             *
    *************************************************************************/
   /*
    * inserting an attachment
    * [2]: http://wiki.apache.org/couchdb/HTTP_Document_API
    *
    * e.g.
    * db.attachment.insert("new", "att", buffer, "image/bmp", {rev: b.rev},
    *   function(_,response) {
    *     console.log(response);
    * });
    *
    * don't forget that params.rev is required in most cases. only exception
    * is when creating a new document with a new attachment. consult [2] for
    * details
    *
    * @param {doc_name:string} document name
    * @param {att_name:string} attachment name
    * @param {att:buffer} attachment data
    * @param {content_type:string} attachment content-type
    * @param {params:object:optional} additions to the querystring
    *
    * @see relax
    */
    function insert_att(doc_name,att_name,att,content_type,params,callback) {
      if(typeof params === "function") {
        callback = params;
        params   = {};
      }
      return relax(
        { db: db_name, att: att_name, method: "PUT"
        , content_type: content_type
        , doc: doc_name, params: params, body: att },callback);
    }

   /*
    * get an attachment
    *
    * @param {doc_name:string} document name
    * @param {att_name:string} attachment name
    * @param {params:object:optional} additions to the querystring
    *
    * @see relax
    */
    function get_att(doc_name,att_name,params,callback) {
      if(typeof params === "function") {
        callback = params;
        params   = {};
      }
      return relax({ db: db_name, att: att_name, method: "GET", doc: doc_name
                   , params: params, encoding: "binary" }, callback);
    }

   /*
    * destroy an attachment
    *
    * @param {doc_name:string} document name
    * @param {att_name:string} attachment name
    * @param {rev:string} previous document revision
    *
    * @see relax
    */
    function destroy_att(doc_name,att_name,rev,callback) {
      return relax({ db: db_name, att: att_name, method: "DELETE"
                  , doc: doc_name, params: {rev: rev}},callback);
    }

    public_functions = { info: function(cb) { return get_db(db_name,cb); }
                       , replicate: function(target,continuous,cb) {
                           if(typeof continuous === "function") {
                             cb         = continuous;
                             continuous = false;
                           }
                           return replicate_db(db_name,target,continuous,cb);
                         }
                       , compact   : function(cb) { 
                           return compact_db(db_name,cb); 
                          }
                       , changes   : function(params,cb) {
                           return changes_db(db_name,params,cb);
                         }
                       , insert    : insert_doc
                       , get       : get_doc
                       , destroy   : destroy_doc
                       , bulk      : bulk_docs
                       , list      : list_docs
                       , attachment: 
                         { insert  : insert_att
                         , get     : get_att
                         , destroy : destroy_att
                         }
                       };
    public_functions.view = view_docs;
    public_functions.view.compact = function(design_name,cb) {
      return compact_db(db_name,design_name,cb);
    };
    return public_functions;
  }

  public_functions = { db:  { create     : create_db
                            , get        : get_db
                            , destroy    : destroy_db
                            , list       : list_dbs
                            , use        : document_module   // alias
                            , scope      : document_module   // alias
                            , compact    : compact_db
                            , replicate  : replicate_db
                            , changes    : changes_db
                            }
                     , session: { create : create_session
                                , destroy: destroy_session
                                }
                     , use               : document_module
                     , scope             : document_module   // alias
                     , request           : relax
                     , config            : cfg
                     , relax             : relax             // alias
                     , dinosaur          : relax             // alias
                     };

  // does the user want a database, or nano?
  if(path.pathname && !nano.fn.is_empty(path.pathname.split('/')[1])) {
    db = path.pathname.split('/')[1];
    cfg.url = path.protocol + '//' + path.host; // reset url
    return document_module(db);
  }
  else   { return public_functions; }
};

/*
 * and now an ascii dinosaur
 *              _
 *            / _) ROAR! i'm a vegan!
 *     .-^^^-/ /
 *  __/       /
 * /__.|_|-|_|
 *
 * thanks for visiting! come again!
 *
 * LH1059-A321
 * LH1178-A321
 */

// =================================================================== err ~==

 /*
  * generic error
  *
  * e.g. missing rev information:
  *
  * { "stack": "Error: Document update conflict. at gen_err(error.js:14:43)",
  *   "message": "Document update conflict.",
  *   "error": "conflict",
  *   "http_code": 409,
  *   "namespace": "couch",
  *   "request": {
  *       "method": "PUT",
  *       "headers": {
  *           "content-type": "application/json",
  *           "accept": "application/json",
  *           "authorization": "BasicYWRtaW46YWRtaW4=",
  *           "content-length": 13
  *       },
  *       "body": {"foo": "baz"},
  *       "uri": "http://admin:admin@localhost: 5984/doc_up1/foo",
  *       "callback": [Function]
  *   }
  * }
  * 
  * extension on error to support more complex logic.
  * 
  * @param {error:error|string} the error or a reason for the error
  * @param {code:string} the recognizable error code
  * @param {http_code:integer:optional} the http code from couchdb
  * @param {request:object} the request that was made to couch
  * @param {type:string} a namespace for the error, e.g. couch 
  *
  * @return an augmented error that helps you know more than the stack trace
  */
 function gen_err(scope,err,code,request,status_code) {
   err         = err             || 'Unknown Error';
   code        = code            || 'unknown';
   status_code = typeof status_code === 'number' && status_code || 500;
   request     = request                                        || {};
   if(typeof err === 'string') { err = new Error(err); }
   err.error          = code;
   err['status-code'] = status_code;
   err.scope          = scope;
   err.request        = request;
   return err;
 }

 nano.err = 
   { uncaught : function (e,c,r,s) { return gen_err('uncaught',e,c,r,s); }
   , request  : function (e,c,r,s) { return gen_err('request',e,c,r,s);  }
   , couch    : function (e,c,r,s) { return gen_err('couch',e,c,r,s);    }
   };

// ============================================================= externals ~==
var QS = (function () {
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  // Query String Utilities
  
  var QueryString = {};
  var urlDecode = process.binding('http_parser').urlDecode;
  
  // If obj.hasOwnProperty has been overridden, then calling
  // obj.hasOwnProperty(prop) will break.
  // See: https://github.com/joyent/node/issues/1707
  function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }
  
  function charCode(c) {
    return c.charCodeAt(0);
  }
  
  
  // a safe fast alternative to decodeURIComponent
  QueryString.unescapeBuffer = function(s, decodeSpaces) {
    var out = new Buffer(s.length);
    var state = 'CHAR'; // states: CHAR, HEX0, HEX1
    var n, m, hexchar;
  
    for (var inIndex = 0, outIndex = 0; inIndex <= s.length; inIndex++) {
      var c = s.charCodeAt(inIndex);
      switch (state) {
        case 'CHAR':
          switch (c) {
            case charCode('%'):
              n = 0;
              m = 0;
              state = 'HEX0';
              break;
            case charCode('+'):
              if (decodeSpaces) c = charCode(' ');
              // pass thru
            default:
              out[outIndex++] = c;
              break;
          }
          break;
  
        case 'HEX0':
          state = 'HEX1';
          hexchar = c;
          if (charCode('0') <= c && c <= charCode('9')) {
            n = c - charCode('0');
          } else if (charCode('a') <= c && c <= charCode('f')) {
            n = c - charCode('a') + 10;
          } else if (charCode('A') <= c && c <= charCode('F')) {
            n = c - charCode('A') + 10;
          } else {
            out[outIndex++] = charCode('%');
            out[outIndex++] = c;
            state = 'CHAR';
            break;
          }
          break;
  
        case 'HEX1':
          state = 'CHAR';
          if (charCode('0') <= c && c <= charCode('9')) {
            m = c - charCode('0');
          } else if (charCode('a') <= c && c <= charCode('f')) {
            m = c - charCode('a') + 10;
          } else if (charCode('A') <= c && c <= charCode('F')) {
            m = c - charCode('A') + 10;
          } else {
            out[outIndex++] = charCode('%');
            out[outIndex++] = hexchar;
            out[outIndex++] = c;
            break;
          }
          out[outIndex++] = 16 * n + m;
          break;
      }
    }
  
    // TODO support returning arbitrary buffers.
  
    return out.slice(0, outIndex - 1);
  };
  
  
  QueryString.unescape = function(s, decodeSpaces) {
    return QueryString.unescapeBuffer(s, decodeSpaces).toString();
  };
  
  
  QueryString.escape = function(str) {
    return encodeURIComponent(str);
  };
  
  var stringifyPrimitive = function(v) {
    switch (typeof v) {
      case 'string':
        return v;
  
      case 'boolean':
        return v ? 'true' : 'false';
  
      case 'number':
        return isFinite(v) ? v : '';
  
      default:
        return '';
    }
  };
  
  
  QueryString.stringify = QueryString.encode = function(obj, sep, eq, name) {
    sep = sep || '&';
    eq = eq || '=';
    obj = (obj === null) ? undefined : obj;
  
    if (typeof obj === 'object') {
      return Object.keys(obj).map(function(k) {
        if (Array.isArray(obj[k])) {
          return obj[k].map(function(v) {
            return QueryString.escape(stringifyPrimitive(k)) +
                   eq +
                   QueryString.escape(stringifyPrimitive(v));
          }).join(sep);
        } else {
          return QueryString.escape(stringifyPrimitive(k)) +
                 eq +
                 QueryString.escape(stringifyPrimitive(obj[k]));
        }
      }).join(sep);
    } else {
      if (!name) return '';
      return QueryString.escape(stringifyPrimitive(name)) + eq +
             QueryString.escape(stringifyPrimitive(obj));
    }
  };
  
  // Parse a key=val string.
  QueryString.parse = QueryString.decode = function(qs, sep, eq) {
    sep = sep || '&';
    eq = eq || '=';
    var obj = {};
  
    if (typeof qs !== 'string' || qs.length === 0) {
      return obj;
    }
  
    qs.split(sep).forEach(function(kvp) {
      var x = kvp.split(eq);
      var k = QueryString.unescape(x[0], true);
      var v = QueryString.unescape(x.slice(1).join(eq), true);
  
      if (!hasOwnProperty(obj, k)) {
        obj[k] = v;
      } else if (!Array.isArray(obj[k])) {
        obj[k] = [obj[k], v];
      } else {
        obj[k].push(v);
      }
    });
  
    return obj;
  };
  return QueryString;
})();
// =============================================================== exports ~==
nano.fn = {qs_encode: QS.encode};
if (typeof exports !== 'undefined') { // nodejs
  nano.platform     = { name: "node.js", version: process.version };
  nano.version      = JSON.parse(
    require('fs').readFileSync(__dirname + "/package.json")).version;
  nano.path         = __dirname;
  nano.fn.request   = require('request');
  nano.fn.is_empty  = require('underscore').isEmpty;
  nano.fn.url_parse = require('url').parse;
  nano.fn.err       = console.error;
  nano.fn.buffer    = function (str) { return new Buffer(str); };
  nano.fn.verbose   = function (msg, log_level) { 
    if (process.env.NANO_ENV==='testing') {
      console.log(msg);
    }
  };
  nano.fn.check_cfg = function (cfg) {
    if(typeof cfg === "string") {
      if(/^https?:/.test(cfg)) { cfg = {url: cfg}; } // url
      else {
        try { cfg = require(cfg); } // file path
        catch(e) { nano.fn.err("bad cfg: couldn't load file"); }
      }
    }
    if(!cfg) { nano.fn.err("bad cfg: you passed undefined"); cfg = {}; }
    if(!cfg.url) {
      nano.fn.err("bad cfg: using default=" + default_url);
      cfg = {url: default_url}; // if everything else fails, use default
    }
    return cfg;
  };
  nano.fn.set_proxy = function (proxy) {
    nano.fn.request = nano.fn.request.defaults({proxy: cfg.proxy});
  };
  nano.fn.set_verbose = function (f) {
    nano.fn.verbose = function (msg,log_level) {
      if (process.env.NANO_ENV==='testing') {
        f(msg,log_level);
      }
    };
  };
  nano.fn.set_body = function (req,body) {
    req.body = Buffer.isBuffer(body) ? body : JSON.stringify(body);
  };
  nano.fn.JSON     = JSON;
  if (typeof module !== 'undefined' && module.exports) {
    exports = module.exports = nano;
  }
  exports.nano = nano;
} else { // browser
  // browser detection is possible in the future
  nano.platform     = { name: "browser" };
  nano.version      = "0.9.5";
  if (typeof define === 'function' && define.amd) {
    define('nano', function() { return nano; });
  } 
  else { root.nano = nano; }
}
})();