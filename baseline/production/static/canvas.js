function cb(n) {
  return n && n.__esModule && Object.prototype.hasOwnProperty.call(n, "default") ? n.default : n;
}
var xm = { exports: {} }, lc = {};
var ex;
function J2() {
  if (ex) return lc;
  ex = 1;
  var n = /* @__PURE__ */ Symbol.for("react.transitional.element"), a = /* @__PURE__ */ Symbol.for("react.fragment");
  function s(r, o, f) {
    var h = null;
    if (f !== void 0 && (h = "" + f), o.key !== void 0 && (h = "" + o.key), "key" in o) {
      f = {};
      for (var m in o)
        m !== "key" && (f[m] = o[m]);
    } else f = o;
    return o = f.ref, {
      $$typeof: n,
      type: r,
      key: h,
      ref: o !== void 0 ? o : null,
      props: f
    };
  }
  return lc.Fragment = a, lc.jsx = s, lc.jsxs = s, lc;
}
var tx;
function F2() {
  return tx || (tx = 1, xm.exports = J2()), xm.exports;
}
var d = F2(), bm = { exports: {} }, Qe = {};
var nx;
function W2() {
  if (nx) return Qe;
  nx = 1;
  var n = /* @__PURE__ */ Symbol.for("react.transitional.element"), a = /* @__PURE__ */ Symbol.for("react.portal"), s = /* @__PURE__ */ Symbol.for("react.fragment"), r = /* @__PURE__ */ Symbol.for("react.strict_mode"), o = /* @__PURE__ */ Symbol.for("react.profiler"), f = /* @__PURE__ */ Symbol.for("react.consumer"), h = /* @__PURE__ */ Symbol.for("react.context"), m = /* @__PURE__ */ Symbol.for("react.forward_ref"), v = /* @__PURE__ */ Symbol.for("react.suspense"), y = /* @__PURE__ */ Symbol.for("react.memo"), g = /* @__PURE__ */ Symbol.for("react.lazy"), p = /* @__PURE__ */ Symbol.for("react.activity"), S = /* @__PURE__ */ Symbol.for("react.view_transition"), w = Symbol.iterator;
  function E(L) {
    return L === null || typeof L != "object" ? null : (L = w && L[w] || L["@@iterator"], typeof L == "function" ? L : null);
  }
  var N = {
    isMounted: function() {
      return !1;
    },
    enqueueForceUpdate: function() {
    },
    enqueueReplaceState: function() {
    },
    enqueueSetState: function() {
    }
  }, _ = Object.assign, C = {};
  function D(L, ce, pe) {
    this.props = L, this.context = ce, this.refs = C, this.updater = pe || N;
  }
  D.prototype.isReactComponent = {}, D.prototype.setState = function(L, ce) {
    if (typeof L != "object" && typeof L != "function" && L != null)
      throw Error(
        "takes an object of state variables to update or a function which returns an object of state variables."
      );
    this.updater.enqueueSetState(this, L, ce, "setState");
  }, D.prototype.forceUpdate = function(L) {
    this.updater.enqueueForceUpdate(this, L, "forceUpdate");
  };
  function M() {
  }
  M.prototype = D.prototype;
  function R(L, ce, pe) {
    this.props = L, this.context = ce, this.refs = C, this.updater = pe || N;
  }
  var Q = R.prototype = new M();
  Q.constructor = R, _(Q, D.prototype), Q.isPureReactComponent = !0;
  var V = Array.isArray;
  function k() {
  }
  var H = { H: null, A: null, T: null, S: null }, q = Object.prototype.hasOwnProperty;
  function de(L, ce, pe) {
    var Se = pe.ref;
    return {
      $$typeof: n,
      type: L,
      key: ce,
      ref: Se !== void 0 ? Se : null,
      props: pe
    };
  }
  function ee(L, ce) {
    return de(L.type, ce, L.props);
  }
  function me(L) {
    return typeof L == "object" && L !== null && L.$$typeof === n;
  }
  function te(L) {
    var ce = { "=": "=0", ":": "=2" };
    return "$" + L.replace(/[=:]/g, function(pe) {
      return ce[pe];
    });
  }
  var O = /\/+/g;
  function Y(L, ce) {
    return typeof L == "object" && L !== null && L.key != null ? te("" + L.key) : ce.toString(36);
  }
  function j(L) {
    switch (L.status) {
      case "fulfilled":
        return L.value;
      case "rejected":
        throw L.reason;
      default:
        switch (typeof L.status == "string" ? L.then(k, k) : (L.status = "pending", L.then(
          function(ce) {
            L.status === "pending" && (L.status = "fulfilled", L.value = ce);
          },
          function(ce) {
            L.status === "pending" && (L.status = "rejected", L.reason = ce);
          }
        )), L.status) {
          case "fulfilled":
            return L.value;
          case "rejected":
            throw L.reason;
        }
    }
    throw L;
  }
  function B(L, ce, pe, Se, le) {
    var Te = typeof L;
    (Te === "undefined" || Te === "boolean") && (L = null);
    var Ce = !1;
    if (L === null) Ce = !0;
    else
      switch (Te) {
        case "bigint":
        case "string":
        case "number":
          Ce = !0;
          break;
        case "object":
          switch (L.$$typeof) {
            case n:
            case a:
              Ce = !0;
              break;
            case g:
              return Ce = L._init, B(
                Ce(L._payload),
                ce,
                pe,
                Se,
                le
              );
          }
      }
    if (Ce)
      return le = le(L), Ce = Se === "" ? "." + Y(L, 0) : Se, V(le) ? (pe = "", Ce != null && (pe = Ce.replace(O, "$&/") + "/"), B(le, ce, pe, "", function(ze) {
        return ze;
      })) : le != null && (me(le) && (le = ee(
        le,
        pe + (le.key == null || L && L.key === le.key ? "" : ("" + le.key).replace(
          O,
          "$&/"
        ) + "/") + Ce
      )), ce.push(le)), 1;
    Ce = 0;
    var we = Se === "" ? "." : Se + ":";
    if (V(L))
      for (var Ne = 0; Ne < L.length; Ne++)
        Se = L[Ne], Te = we + Y(Se, Ne), Ce += B(
          Se,
          ce,
          pe,
          Te,
          le
        );
    else if (Ne = E(L), typeof Ne == "function")
      for (L = Ne.call(L), Ne = 0; !(Se = L.next()).done; )
        Se = Se.value, Te = we + Y(Se, Ne++), Ce += B(
          Se,
          ce,
          pe,
          Te,
          le
        );
    else if (Te === "object") {
      if (typeof L.then == "function")
        return B(
          j(L),
          ce,
          pe,
          Se,
          le
        );
      throw ce = String(L), Error(
        "Objects are not valid as a React child (found: " + (ce === "[object Object]" ? "object with keys {" + Object.keys(L).join(", ") + "}" : ce) + "). If you meant to render a collection of children, use an array instead."
      );
    }
    return Ce;
  }
  function X(L, ce, pe) {
    if (L == null) return L;
    var Se = [], le = 0;
    return B(L, Se, "", "", function(Te) {
      return ce.call(pe, Te, le++);
    }), Se;
  }
  function J(L) {
    if (L._status === -1) {
      var ce = L._result, pe = ce();
      pe.then(
        function(Se) {
          (L._status === 0 || L._status === -1) && (L._status = 1, L._result = Se, pe.status === void 0 && (pe.status = "fulfilled", pe.value = Se));
        },
        function(Se) {
          (L._status === 0 || L._status === -1) && (L._status = 2, L._result = Se, pe.status === void 0 && (pe.status = "rejected", pe.reason = Se));
        }
      ), L._status === -1 && (L._status = 0, L._result = pe);
    }
    if (L._status === 1) return L._result.default;
    throw L._result;
  }
  var I = typeof reportError == "function" ? reportError : function(L) {
    if (typeof window == "object" && typeof window.ErrorEvent == "function") {
      var ce = new window.ErrorEvent("error", {
        bubbles: !0,
        cancelable: !0,
        message: typeof L == "object" && L !== null && typeof L.message == "string" ? String(L.message) : String(L),
        error: L
      });
      if (!window.dispatchEvent(ce)) return;
    } else if (typeof process == "object" && typeof process.emit == "function") {
      process.emit("uncaughtException", L);
      return;
    }
    console.error(L);
  };
  function ae(L) {
    var ce = H.T, pe = {};
    pe.types = ce !== null ? ce.types : null, H.T = pe;
    try {
      var Se = L(), le = H.S;
      le !== null && le(pe, Se), typeof Se == "object" && Se !== null && typeof Se.then == "function" && Se.then(k, I);
    } catch (Te) {
      I(Te);
    } finally {
      ce !== null && pe.types !== null && (ce.types = pe.types), H.T = ce;
    }
  }
  function he(L) {
    var ce = H.T;
    if (ce !== null) {
      var pe = ce.types;
      pe === null ? ce.types = [L] : pe.indexOf(L) === -1 && pe.push(L);
    } else ae(he.bind(null, L));
  }
  var Ee = {
    map: X,
    forEach: function(L, ce, pe) {
      X(
        L,
        function() {
          ce.apply(this, arguments);
        },
        pe
      );
    },
    count: function(L) {
      var ce = 0;
      return X(L, function() {
        ce++;
      }), ce;
    },
    toArray: function(L) {
      return X(L, function(ce) {
        return ce;
      }) || [];
    },
    only: function(L) {
      if (!me(L))
        throw Error(
          "React.Children.only expected to receive a single React element child."
        );
      return L;
    }
  };
  return Qe.Activity = p, Qe.Children = Ee, Qe.Component = D, Qe.Fragment = s, Qe.Profiler = o, Qe.PureComponent = R, Qe.StrictMode = r, Qe.Suspense = v, Qe.ViewTransition = S, Qe.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = H, Qe.__COMPILER_RUNTIME = {
    __proto__: null,
    c: function(L) {
      return H.H.useMemoCache(L);
    }
  }, Qe.addTransitionType = he, Qe.cache = function(L) {
    return function() {
      return L.apply(null, arguments);
    };
  }, Qe.cacheSignal = function() {
    return null;
  }, Qe.cloneElement = function(L, ce, pe) {
    if (L == null)
      throw Error(
        "The argument must be a React element, but you passed " + L + "."
      );
    var Se = _({}, L.props), le = L.key;
    if (ce != null)
      for (Te in ce.key !== void 0 && (le = "" + ce.key), ce)
        !q.call(ce, Te) || Te === "key" || Te === "__self" || Te === "__source" || Te === "ref" && ce.ref === void 0 || (Se[Te] = ce[Te]);
    var Te = arguments.length - 2;
    if (Te === 1) Se.children = pe;
    else if (1 < Te) {
      for (var Ce = Array(Te), we = 0; we < Te; we++)
        Ce[we] = arguments[we + 2];
      Se.children = Ce;
    }
    return de(L.type, le, Se);
  }, Qe.createContext = function(L) {
    return L = {
      $$typeof: h,
      _currentValue: L,
      _currentValue2: L,
      _threadCount: 0,
      Provider: null,
      Consumer: null
    }, L.Provider = L, L.Consumer = {
      $$typeof: f,
      _context: L
    }, L;
  }, Qe.createElement = function(L, ce, pe) {
    var Se, le = {}, Te = null;
    if (ce != null)
      for (Se in ce.key !== void 0 && (Te = "" + ce.key), ce)
        q.call(ce, Se) && Se !== "key" && Se !== "__self" && Se !== "__source" && (le[Se] = ce[Se]);
    var Ce = arguments.length - 2;
    if (Ce === 1) le.children = pe;
    else if (1 < Ce) {
      for (var we = Array(Ce), Ne = 0; Ne < Ce; Ne++)
        we[Ne] = arguments[Ne + 2];
      le.children = we;
    }
    if (L && L.defaultProps)
      for (Se in Ce = L.defaultProps, Ce)
        le[Se] === void 0 && (le[Se] = Ce[Se]);
    return de(L, Te, le);
  }, Qe.createRef = function() {
    return { current: null };
  }, Qe.forwardRef = function(L) {
    return { $$typeof: m, render: L };
  }, Qe.isValidElement = me, Qe.lazy = function(L) {
    return {
      $$typeof: g,
      _payload: { _status: -1, _result: L },
      _init: J
    };
  }, Qe.memo = function(L, ce) {
    return {
      $$typeof: y,
      type: L,
      compare: ce === void 0 ? null : ce
    };
  }, Qe.startTransition = ae, Qe.unstable_useCacheRefresh = function() {
    return H.H.useCacheRefresh();
  }, Qe.use = function(L) {
    return H.H.use(L);
  }, Qe.useActionState = function(L, ce, pe) {
    return H.H.useActionState(L, ce, pe);
  }, Qe.useCallback = function(L, ce) {
    return H.H.useCallback(L, ce);
  }, Qe.useContext = function(L) {
    return H.H.useContext(L);
  }, Qe.useDebugValue = function() {
  }, Qe.useDeferredValue = function(L, ce) {
    return H.H.useDeferredValue(L, ce);
  }, Qe.useEffect = function(L, ce) {
    return H.H.useEffect(L, ce);
  }, Qe.useEffectEvent = function(L) {
    return H.H.useEffectEvent(L);
  }, Qe.useId = function() {
    return H.H.useId();
  }, Qe.useImperativeHandle = function(L, ce, pe) {
    return H.H.useImperativeHandle(L, ce, pe);
  }, Qe.useInsertionEffect = function(L, ce) {
    return H.H.useInsertionEffect(L, ce);
  }, Qe.useLayoutEffect = function(L, ce) {
    return H.H.useLayoutEffect(L, ce);
  }, Qe.useMemo = function(L, ce) {
    return H.H.useMemo(L, ce);
  }, Qe.useOptimistic = function(L, ce) {
    return H.H.useOptimistic(L, ce);
  }, Qe.useReducer = function(L, ce, pe) {
    return H.H.useReducer(L, ce, pe);
  }, Qe.useRef = function(L) {
    return H.H.useRef(L);
  }, Qe.useState = function(L) {
    return H.H.useState(L);
  }, Qe.useSyncExternalStore = function(L, ce, pe) {
    return H.H.useSyncExternalStore(
      L,
      ce,
      pe
    );
  }, Qe.useTransition = function() {
    return H.H.useTransition();
  }, Qe.version = "19.3.1", Qe;
}
var ix;
function Hc() {
  return ix || (ix = 1, bm.exports = W2()), bm.exports;
}
var A = Hc();
const yc = /* @__PURE__ */ cb(A);
var Sm = { exports: {} }, sc = {}, wm = { exports: {} }, _m = {};
var ax;
function eE() {
  return ax || (ax = 1, (function(n) {
    function a(j, B) {
      var X = j.length;
      j.push(B);
      e: for (; 0 < X; ) {
        var J = X - 1 >>> 1, I = j[J];
        if (0 < o(I, B))
          j[J] = B, j[X] = I, X = J;
        else break e;
      }
    }
    function s(j) {
      return j.length === 0 ? null : j[0];
    }
    function r(j) {
      if (j.length === 0) return null;
      var B = j[0], X = j.pop();
      if (X !== B) {
        j[0] = X;
        e: for (var J = 0, I = j.length, ae = I >>> 1; J < ae; ) {
          var he = 2 * (J + 1) - 1, Ee = j[he], L = he + 1, ce = j[L];
          if (0 > o(Ee, X))
            L < I && 0 > o(ce, Ee) ? (j[J] = ce, j[L] = X, J = L) : (j[J] = Ee, j[he] = X, J = he);
          else if (L < I && 0 > o(ce, X))
            j[J] = ce, j[L] = X, J = L;
          else break e;
        }
      }
      return B;
    }
    function o(j, B) {
      var X = j.sortIndex - B.sortIndex;
      return X !== 0 ? X : j.id - B.id;
    }
    if (n.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
      var f = performance;
      n.unstable_now = function() {
        return f.now();
      };
    } else {
      var h = Date, m = h.now();
      n.unstable_now = function() {
        return h.now() - m;
      };
    }
    var v = [], y = [], g = 1, p = null, S = 3, w = !1, E = !1, N = !1, _ = !1, C = typeof setTimeout == "function" ? setTimeout : null, D = typeof clearTimeout == "function" ? clearTimeout : null, M = typeof setImmediate < "u" ? setImmediate : null;
    function R(j) {
      for (var B = s(y); B !== null; ) {
        if (B.callback === null) r(y);
        else if (B.startTime <= j)
          r(y), B.sortIndex = B.expirationTime, a(v, B);
        else break;
        B = s(y);
      }
    }
    function Q(j) {
      if (N = !1, R(j), !E)
        if (s(v) !== null)
          E = !0, V || (V = !0, me());
        else {
          var B = s(y);
          B !== null && Y(Q, B.startTime - j);
        }
    }
    var V = !1, k = -1, H = 5, q = -1;
    function de() {
      return _ ? !0 : !(n.unstable_now() - q < H);
    }
    function ee() {
      if (_ = !1, V) {
        var j = n.unstable_now();
        q = j;
        var B = !0;
        try {
          e: {
            E = !1, N && (N = !1, D(k), k = -1), w = !0;
            var X = S;
            try {
              t: {
                for (R(j), p = s(v); p !== null && !(p.expirationTime > j && de()); ) {
                  var J = p.callback;
                  if (typeof J == "function") {
                    p.callback = null, S = p.priorityLevel;
                    var I = J(
                      p.expirationTime <= j
                    );
                    if (j = n.unstable_now(), typeof I == "function") {
                      p.callback = I, R(j), B = !0;
                      break t;
                    }
                    p === s(v) && r(v), R(j);
                  } else r(v);
                  p = s(v);
                }
                if (p !== null) B = !0;
                else {
                  var ae = s(y);
                  ae !== null && Y(
                    Q,
                    ae.startTime - j
                  ), B = !1;
                }
              }
              break e;
            } finally {
              p = null, S = X, w = !1;
            }
            B = void 0;
          }
        } finally {
          B ? me() : V = !1;
        }
      }
    }
    var me;
    if (typeof M == "function")
      me = function() {
        M(ee);
      };
    else if (typeof MessageChannel < "u") {
      var te = new MessageChannel(), O = te.port2;
      te.port1.onmessage = ee, me = function() {
        O.postMessage(null);
      };
    } else
      me = function() {
        C(ee, 0);
      };
    function Y(j, B) {
      k = C(function() {
        j(n.unstable_now());
      }, B);
    }
    n.unstable_IdlePriority = 5, n.unstable_ImmediatePriority = 1, n.unstable_LowPriority = 4, n.unstable_NormalPriority = 3, n.unstable_Profiling = null, n.unstable_UserBlockingPriority = 2, n.unstable_cancelCallback = function(j) {
      j.callback = null;
    }, n.unstable_forceFrameRate = function(j) {
      0 > j || 125 < j ? console.error(
        "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"
      ) : H = 0 < j ? Math.floor(1e3 / j) : 5;
    }, n.unstable_getCurrentPriorityLevel = function() {
      return S;
    }, n.unstable_next = function(j) {
      switch (S) {
        case 1:
        case 2:
        case 3:
          var B = 3;
          break;
        default:
          B = S;
      }
      var X = S;
      S = B;
      try {
        return j();
      } finally {
        S = X;
      }
    }, n.unstable_requestPaint = function() {
      _ = !0;
    }, n.unstable_runWithPriority = function(j, B) {
      switch (j) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          j = 3;
      }
      var X = S;
      S = j;
      try {
        return B();
      } finally {
        S = X;
      }
    }, n.unstable_scheduleCallback = function(j, B, X) {
      var J = n.unstable_now();
      switch (typeof X == "object" && X !== null ? (X = X.delay, X = typeof X == "number" && 0 < X ? J + X : J) : X = J, j) {
        case 1:
          var I = -1;
          break;
        case 2:
          I = 250;
          break;
        case 5:
          I = 1073741823;
          break;
        case 4:
          I = 1e4;
          break;
        default:
          I = 5e3;
      }
      return I = X + I, j = {
        id: g++,
        callback: B,
        priorityLevel: j,
        startTime: X,
        expirationTime: I,
        sortIndex: -1
      }, X > J ? (j.sortIndex = X, a(y, j), s(v) === null && j === s(y) && (N ? (D(k), k = -1) : N = !0, Y(Q, X - J))) : (j.sortIndex = I, a(v, j), E || w || (E = !0, V || (V = !0, me()))), j;
    }, n.unstable_shouldYield = de, n.unstable_wrapCallback = function(j) {
      var B = S;
      return function() {
        var X = S;
        S = B;
        try {
          return j.apply(this, arguments);
        } finally {
          S = X;
        }
      };
    };
  })(_m)), _m;
}
var lx;
function tE() {
  return lx || (lx = 1, wm.exports = eE()), wm.exports;
}
var Em = { exports: {} }, ai = {};
var sx;
function nE() {
  if (sx) return ai;
  sx = 1;
  var n = Hc();
  function a(g) {
    var p = "https://react.dev/errors/" + g;
    if (1 < arguments.length) {
      p += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var S = 2; S < arguments.length; S++)
        p += "&args[]=" + encodeURIComponent(arguments[S]);
    }
    return "Minified React error #" + g + "; visit " + p + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  function s() {
  }
  var r = {
    d: {
      f: s,
      r: function() {
        throw Error(a(522));
      },
      D: s,
      C: s,
      L: s,
      m: s,
      X: s,
      S: s,
      M: s
    },
    p: 0,
    findDOMNode: null
  }, o = /* @__PURE__ */ Symbol.for("react.portal"), f = /* @__PURE__ */ Symbol.for("react.recoverable"), h = /* @__PURE__ */ Symbol.for("react.optimistic_key");
  function m(g, p, S) {
    var w = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: o,
      key: w == null ? null : w === h ? h : "" + w,
      children: g,
      containerInfo: p,
      implementation: S
    };
  }
  var v = n.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function y(g, p) {
    if (g === "font") return "";
    if (typeof p == "string")
      return p === "use-credentials" ? p : "";
  }
  return ai.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = r, ai.browser = function(g) {
    return { $$typeof: f, _reason: g };
  }, ai.createPortal = function(g, p) {
    var S = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
    if (!p || p.nodeType !== 1 && p.nodeType !== 9 && p.nodeType !== 11)
      throw Error(a(299));
    return m(g, p, null, S);
  }, ai.flushSync = function(g) {
    var p = v.T, S = r.p;
    try {
      if (v.T = null, r.p = 2, g) return g();
    } finally {
      v.T = p, r.p = S, r.d.f();
    }
  }, ai.preconnect = function(g, p) {
    typeof g == "string" && (p ? (p = p.crossOrigin, p = typeof p == "string" ? p === "use-credentials" ? p : "" : void 0) : p = null, r.d.C(g, p));
  }, ai.prefetchDNS = function(g) {
    typeof g == "string" && r.d.D(g);
  }, ai.preinit = function(g, p) {
    if (typeof g == "string" && p && typeof p.as == "string") {
      var S = p.as, w = y(S, p.crossOrigin), E = typeof p.integrity == "string" ? p.integrity : void 0, N = typeof p.fetchPriority == "string" ? p.fetchPriority : void 0;
      S === "style" ? r.d.S(
        g,
        typeof p.precedence == "string" ? p.precedence : void 0,
        {
          crossOrigin: w,
          integrity: E,
          fetchPriority: N
        }
      ) : S === "script" && r.d.X(g, {
        crossOrigin: w,
        integrity: E,
        fetchPriority: N,
        nonce: typeof p.nonce == "string" ? p.nonce : void 0
      });
    }
  }, ai.preinitModule = function(g, p) {
    if (typeof g == "string")
      if (typeof p == "object" && p !== null) {
        if (p.as == null || p.as === "script") {
          var S = y(
            p.as,
            p.crossOrigin
          );
          r.d.M(g, {
            crossOrigin: S,
            integrity: typeof p.integrity == "string" ? p.integrity : void 0,
            nonce: typeof p.nonce == "string" ? p.nonce : void 0,
            fetchPriority: typeof p.fetchPriority == "string" ? p.fetchPriority : void 0
          });
        }
      } else p == null && r.d.M(g);
  }, ai.preload = function(g, p) {
    if (typeof g == "string" && typeof p == "object" && p !== null && typeof p.as == "string") {
      var S = p.as, w = y(S, p.crossOrigin);
      r.d.L(g, S, {
        crossOrigin: w,
        integrity: typeof p.integrity == "string" ? p.integrity : void 0,
        nonce: typeof p.nonce == "string" ? p.nonce : void 0,
        type: typeof p.type == "string" ? p.type : void 0,
        fetchPriority: typeof p.fetchPriority == "string" ? p.fetchPriority : void 0,
        referrerPolicy: typeof p.referrerPolicy == "string" ? p.referrerPolicy : void 0,
        imageSrcSet: typeof p.imageSrcSet == "string" ? p.imageSrcSet : void 0,
        imageSizes: typeof p.imageSizes == "string" ? p.imageSizes : void 0,
        media: typeof p.media == "string" ? p.media : void 0
      });
    }
  }, ai.preloadModule = function(g, p) {
    if (typeof g == "string")
      if (p) {
        var S = y(p.as, p.crossOrigin);
        r.d.m(g, {
          as: typeof p.as == "string" && p.as !== "script" ? p.as : void 0,
          crossOrigin: S,
          integrity: typeof p.integrity == "string" ? p.integrity : void 0,
          nonce: typeof p.nonce == "string" ? p.nonce : void 0,
          fetchPriority: typeof p.fetchPriority == "string" ? p.fetchPriority : void 0
        });
      } else r.d.m(g);
  }, ai.requestFormReset = function(g) {
    r.d.r(g);
  }, ai.unstable_batchedUpdates = function(g, p) {
    return g(p);
  }, ai.useFormState = function(g, p, S) {
    return v.H.useFormState(g, p, S);
  }, ai.useFormStatus = function() {
    return v.H.useHostTransitionStatus();
  }, ai.version = "19.3.1", ai;
}
var rx;
function ub() {
  if (rx) return Em.exports;
  rx = 1;
  function n() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
      } catch (a) {
        console.error(a);
      }
  }
  return n(), Em.exports = nE(), Em.exports;
}
var ox;
function iE() {
  if (ox) return sc;
  ox = 1;
  var n = tE(), a = Hc(), s = ub();
  function r(e) {
    var t = "https://react.dev/errors/" + e;
    if (1 < arguments.length) {
      t += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var i = 2; i < arguments.length; i++)
        t += "&args[]=" + encodeURIComponent(arguments[i]);
    }
    return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  function o(e) {
    return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11);
  }
  function f(e) {
    for (var t = e, i = t; i && !i.alternate; )
      t = i, (t.flags & 4098) !== 0 && (e = t.return), i = t.return;
    for (; t.return; ) t = t.return;
    return t.tag === 3 ? e : null;
  }
  function h(e) {
    if (e.tag === 13) {
      var t = e.memoizedState;
      if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
    }
    return null;
  }
  function m(e) {
    if (e.tag === 31) {
      var t = e.memoizedState;
      if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
    }
    return null;
  }
  function v(e) {
    if (f(e) !== e)
      throw Error(r(188));
  }
  function y(e) {
    var t = e.alternate;
    if (!t) {
      if (t = f(e), t === null) throw Error(r(188));
      return t !== e ? null : e;
    }
    for (var i = e, l = t; ; ) {
      var c = i.return;
      if (c === null) break;
      var u = c.alternate;
      if (u === null) {
        if (l = c.return, l !== null) {
          i = l;
          continue;
        }
        break;
      }
      if (c.child === u.child) {
        for (u = c.child; u; ) {
          if (u === i) return v(c), e;
          if (u === l) return v(c), t;
          u = u.sibling;
        }
        throw Error(r(188));
      }
      if (i.return !== l.return) i = c, l = u;
      else {
        for (var x = !1, T = c.child; T; ) {
          if (T === i) {
            x = !0, i = c, l = u;
            break;
          }
          if (T === l) {
            x = !0, l = c, i = u;
            break;
          }
          T = T.sibling;
        }
        if (!x) {
          for (T = u.child; T; ) {
            if (T === i) {
              x = !0, i = u, l = c;
              break;
            }
            if (T === l) {
              x = !0, l = u, i = c;
              break;
            }
            T = T.sibling;
          }
          if (!x) throw Error(r(189));
        }
      }
      if (i.alternate !== l) throw Error(r(190));
    }
    if (i.tag !== 3) throw Error(r(188));
    return i.stateNode.current === i ? e : t;
  }
  function g(e) {
    var t = e.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return e;
    for (e = e.child; e !== null; ) {
      if (t = g(e), t !== null) return t;
      e = e.sibling;
    }
    return null;
  }
  function p(e, t, i, l, c, u) {
    for (; e !== null; ) {
      if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && i(e, l, c, u) || (e.tag !== 22 || e.memoizedState === null) && (t || e.tag !== 5 && e.tag !== 27) && p(
        e.child,
        t,
        i,
        l,
        c,
        u
      ))
        return !0;
      e = e.sibling;
    }
    return !1;
  }
  function S(e) {
    for (e = e.return; e !== null; ) {
      if (e.tag === 3 || e.tag === 5 || e.tag === 27) return e;
      e = e.return;
    }
    return null;
  }
  function w(e) {
    var t = !1;
    for (e = e.return; e !== null && (e.tag === 4 && (t = !0), !(e.tag === 3 || e.tag === 5 || e.tag === 27)); )
      e = e.return;
    return t;
  }
  function E(e) {
    var t = [null, null], i = S(e);
    return i === null || N(
      t,
      e,
      i.child,
      { foundSelf: !1 }
    ), t;
  }
  function N(e, t, i, l) {
    for (; i !== null; ) {
      if (i === t) l.foundSelf = !0;
      else if (i.tag === 5 || i.tag === 27 || i.tag === 6) {
        if (l.foundSelf) return e[1] = i, !0;
        e[0] = i;
      } else if ((i.tag !== 22 || i.memoizedState === null) && N(
        e,
        t,
        i.child,
        l
      ))
        return !0;
      i = i.sibling;
    }
    return !1;
  }
  function _(e) {
    switch (e.tag) {
      case 5:
      case 27:
      case 6:
        return e.stateNode;
      case 3:
        return e.stateNode.containerInfo;
      default:
        throw Error(r(559));
    }
  }
  var C = null, D = null;
  function M(e, t, i) {
    return e === i ? !0 : e === t ? (C = e, !0) : !1;
  }
  function R(e, t, i) {
    return e === i ? (D = e, !1) : e === t ? (D !== null && (C = e), !0) : !1;
  }
  function Q(e) {
    if (e === null) return null;
    do
      e = e === null ? null : e.return;
    while (e && e.tag !== 5 && e.tag !== 27 && e.tag !== 3);
    return e || null;
  }
  function V(e, t, i) {
    for (var l = 0, c = e; c; c = i(c)) l++;
    c = 0;
    for (var u = t; u; u = i(u)) c++;
    for (; 0 < l - c; ) e = i(e), l--;
    for (; 0 < c - l; ) t = i(t), c--;
    for (; l--; ) {
      if (e === t || t !== null && e === t.alternate)
        return e;
      e = i(e), t = i(t);
    }
    return null;
  }
  var k = Object.assign, H = /* @__PURE__ */ Symbol.for("react.element"), q = /* @__PURE__ */ Symbol.for("react.transitional.element"), de = /* @__PURE__ */ Symbol.for("react.portal"), ee = /* @__PURE__ */ Symbol.for("react.fragment"), me = /* @__PURE__ */ Symbol.for("react.strict_mode"), te = /* @__PURE__ */ Symbol.for("react.profiler"), O = /* @__PURE__ */ Symbol.for("react.consumer"), Y = /* @__PURE__ */ Symbol.for("react.context"), j = /* @__PURE__ */ Symbol.for("react.forward_ref"), B = /* @__PURE__ */ Symbol.for("react.suspense"), X = /* @__PURE__ */ Symbol.for("react.suspense_list"), J = /* @__PURE__ */ Symbol.for("react.memo"), I = /* @__PURE__ */ Symbol.for("react.lazy"), ae = /* @__PURE__ */ Symbol.for("react.activity"), he = /* @__PURE__ */ Symbol.for("react.legacy_hidden"), Ee = /* @__PURE__ */ Symbol.for("react.memo_cache_sentinel"), L = /* @__PURE__ */ Symbol.for("react.view_transition"), ce = /* @__PURE__ */ Symbol.for("react.recoverable"), pe = Symbol.iterator;
  function Se(e) {
    return e === null || typeof e != "object" ? null : (e = pe && e[pe] || e["@@iterator"], typeof e == "function" ? e : null);
  }
  var le = /* @__PURE__ */ Symbol.for("react.client.reference");
  function Te(e) {
    if (e == null) return null;
    if (typeof e == "function")
      return e.$$typeof === le ? null : e.displayName || e.name || null;
    if (typeof e == "string") return e;
    switch (e) {
      case ee:
        return "Fragment";
      case te:
        return "Profiler";
      case me:
        return "StrictMode";
      case B:
        return "Suspense";
      case X:
        return "SuspenseList";
      case ae:
        return "Activity";
      case L:
        return "ViewTransition";
    }
    if (typeof e == "object")
      switch (e.$$typeof) {
        case de:
          return "Portal";
        case Y:
          return e.displayName || "Context";
        case O:
          return (e._context.displayName || "Context") + ".Consumer";
        case j:
          var t = e.render;
          return e = e.displayName, e || (e = t.displayName || t.name || "", e = e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef"), e;
        case J:
          return t = e.displayName || null, t !== null ? t : Te(e.type) || "Memo";
        case I:
          t = e._payload, e = e._init;
          try {
            return Te(e(t));
          } catch {
          }
      }
    return null;
  }
  var Ce = Array.isArray, we = a.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Ne = s.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, ze = {
    pending: !1,
    data: null,
    method: null,
    action: null
  }, Ve = [], $e = -1;
  function Me(e) {
    return { current: e };
  }
  function Ge(e) {
    0 > $e || (e.current = Ve[$e], Ve[$e] = null, $e--);
  }
  function Re(e, t) {
    $e++, Ve[$e] = e.current, e.current = t;
  }
  var _t = Me(null), it = Me(null), At = Me(null), Mn = Me(null);
  function Et(e, t) {
    switch (Re(At, t), Re(it, e), Re(_t, null), t.nodeType) {
      case 9:
      case 11:
        e = (e = t.documentElement) && (e = e.namespaceURI) ? cv(e) : 0;
        break;
      default:
        if (e = t.tagName, t = t.namespaceURI)
          t = cv(t), e = uv(t, e);
        else
          switch (e) {
            case "svg":
              e = 1;
              break;
            case "math":
              e = 2;
              break;
            default:
              e = 0;
          }
    }
    Ge(_t), Re(_t, e);
  }
  function sn() {
    Ge(_t), Ge(it), Ge(At);
  }
  function It(e) {
    var t = e.memoizedState;
    t !== null && (Xr._currentValue = t.memoizedState, Re(Mn, e)), t = _t.current;
    var i = uv(t, e.type);
    t !== i && (Re(it, e), Re(_t, i));
  }
  function bt(e) {
    it.current === e && (Ge(_t), Ge(it)), Mn.current === e && (Ge(Mn), Xr._currentValue = ze);
  }
  var Nt, St;
  function ft(e) {
    if (Nt === void 0)
      try {
        throw Error();
      } catch (i) {
        var t = i.stack.trim().match(/\n( *(at )?)/);
        Nt = t && t[1] || "", St = -1 < i.stack.indexOf(`
    at`) ? " (<anonymous>)" : -1 < i.stack.indexOf("@") ? "@unknown:0:0" : "";
      }
    return `
` + Nt + e + St;
  }
  var Bt = !1;
  function gn(e, t) {
    if (!e || Bt) return "";
    Bt = !0;
    var i = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var l = {
        DetermineComponentFrameRoot: function() {
          try {
            if (t) {
              var ve = function() {
                throw Error();
              };
              if (Object.defineProperty(ve.prototype, "props", {
                set: function() {
                  throw Error();
                }
              }), typeof Reflect == "object" && Reflect.construct) {
                try {
                  Reflect.construct(ve, []);
                } catch (Ae) {
                  var W = Ae;
                }
                Reflect.construct(e, [], ve);
              } else {
                try {
                  ve.call();
                } catch (Ae) {
                  W = Ae;
                }
                ve = !1;
                try {
                  var ue = Object.getOwnPropertyDescriptor(
                    e.prototype,
                    "props"
                  );
                  Object.defineProperty(e.prototype, "props", {
                    configurable: !0,
                    set: function() {
                      throw Error();
                    }
                  }), ve = !0, new e();
                } finally {
                  ve && (ue !== void 0 ? Object.defineProperty(e.prototype, "props", ue) : delete e.prototype.props);
                }
              }
            } else {
              try {
                throw Error();
              } catch (Ae) {
                W = Ae;
              }
              (ve = e()) && typeof ve.catch == "function" && ve.catch(function() {
              });
            }
          } catch (Ae) {
            if (Ae && W && typeof Ae.stack == "string")
              return [Ae.stack, W.stack];
          }
          return [null, null];
        }
      };
      l.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
      var c = Object.getOwnPropertyDescriptor(
        l.DetermineComponentFrameRoot,
        "name"
      );
      c && c.configurable && Object.defineProperty(
        l.DetermineComponentFrameRoot,
        "name",
        { value: "DetermineComponentFrameRoot" }
      );
      var u = l.DetermineComponentFrameRoot(), x = u[0], T = u[1];
      if (x && T) {
        var $ = x.split(`
`), ie = T.split(`
`);
        for (c = l = 0; l < $.length && !$[l].includes("DetermineComponentFrameRoot"); )
          l++;
        for (; c < ie.length && !ie[c].includes(
          "DetermineComponentFrameRoot"
        ); )
          c++;
        if (l === $.length || c === ie.length)
          for (l = $.length - 1, c = ie.length - 1; 1 <= l && 0 <= c && $[l] !== ie[c]; )
            c--;
        for (; 1 <= l && 0 <= c; l--, c--)
          if ($[l] !== ie[c]) {
            if (l !== 1 || c !== 1)
              do
                if (l--, c--, 0 > c || $[l] !== ie[c]) {
                  var fe = `
` + $[l].replace(" at new ", " at ");
                  return e.displayName && fe.includes("<anonymous>") && (fe = fe.replace("<anonymous>", e.displayName)), fe;
                }
              while (1 <= l && 0 <= c);
            break;
          }
      }
    } finally {
      Bt = !1, Error.prepareStackTrace = i;
    }
    return (i = e ? e.displayName || e.name : "") ? ft(i) : "";
  }
  function $t(e, t) {
    switch (e.tag) {
      case 26:
      case 27:
      case 5:
        return ft(e.type);
      case 16:
        return ft("Lazy");
      case 13:
        return e.child !== t && t !== null ? ft("Suspense Fallback") : ft("Suspense");
      case 19:
        return ft("SuspenseList");
      case 0:
      case 15:
        return gn(e.type, !1);
      case 11:
        return gn(e.type.render, !1);
      case 1:
        return gn(e.type, !0);
      case 31:
        return ft("Activity");
      case 30:
        return ft("ViewTransition");
      default:
        return "";
    }
  }
  function Qn(e) {
    try {
      var t = "", i = null;
      do
        t += $t(e, i), i = e, e = e.return;
      while (e);
      return t;
    } catch (l) {
      return `
Error generating stack: ` + l.message + `
` + l.stack;
    }
  }
  var fn = Object.prototype.hasOwnProperty, Gt = n.unstable_scheduleCallback, yn = n.unstable_cancelCallback, Wt = n.unstable_shouldYield, Li = n.unstable_requestPaint, Zt = n.unstable_now, Tt = n.unstable_getCurrentPriorityLevel, vn = n.unstable_ImmediatePriority, dn = n.unstable_UserBlockingPriority, Lt = n.unstable_NormalPriority, zn = n.unstable_LowPriority, Fe = n.unstable_IdlePriority, qa = n.log, xn = n.unstable_setDisableYieldValue, dt = null, en = null;
  function hn(e) {
    if (typeof qa == "function" && xn(e), en && typeof en.setStrictMode == "function")
      try {
        en.setStrictMode(dt, e);
      } catch {
      }
  }
  var Mt = Math.clz32 ? Math.clz32 : oe, ri = Math.log, rn = Math.LN2;
  function oe(e) {
    return e >>>= 0, e === 0 ? 32 : 31 - (ri(e) / rn | 0) | 0;
  }
  var ke = 256, Ye = 262144, K = 4194304;
  function at(e) {
    var t = e & 42;
    if (t !== 0) return t;
    switch (e & -e) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return e & -e;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return e & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return e & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return e;
    }
  }
  function Kn(e, t, i) {
    var l = e.pendingLanes;
    if (l === 0) return 0;
    var c = 0, u = e.suspendedLanes, x = e.pingedLanes;
    e = e.warmLanes;
    var T = l & 134217727;
    return T !== 0 ? (l = T & ~u, l !== 0 ? c = at(l) : (x &= T, x !== 0 ? c = at(x) : i || (i = T & ~e, i !== 0 && (c = at(i))))) : (T = l & ~u, T !== 0 ? c = at(T) : x !== 0 ? c = at(x) : i || (i = l & ~e, i !== 0 && (c = at(i)))), c === 0 ? 0 : t !== 0 && t !== c && (t & u) === 0 && (u = c & -c, i = t & -t, u >= i || u === 32 && (i & 4194048) !== 0) ? t : c;
  }
  function Qt(e, t) {
    return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
  }
  function tn(e, t) {
    (t & 8) !== 0 && (t |= t & 32);
    var i = e.entangledLanes;
    if (i !== 0)
      for (e = e.entanglements, i &= t; 0 < i; ) {
        var l = 31 - Mt(i), c = 1 << l;
        t |= e[l], i &= ~c;
      }
    return t;
  }
  function dl(e, t) {
    switch (e) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return t + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function Ln() {
    var e = K;
    return K <<= 1, (K & 62914560) === 0 && (K = 4194304), e;
  }
  function Va(e) {
    for (var t = [], i = 0; 31 > i; i++) t.push(e);
    return t;
  }
  function nn(e, t) {
    e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
  }
  function Ot(e, t, i, l, c, u) {
    var x = e.pendingLanes;
    e.pendingLanes = i, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= i, e.entangledLanes &= i, e.errorRecoveryDisabledLanes &= i, e.shellSuspendCounter = 0;
    var T = e.entanglements, $ = e.expirationTimes, ie = e.hiddenUpdates;
    for (i = x & ~i; 0 < i; ) {
      var fe = 31 - Mt(i), ve = 1 << fe;
      T[fe] = 0, $[fe] = -1;
      var W = ie[fe];
      if (W !== null)
        for (ie[fe] = null, fe = 0; fe < W.length; fe++) {
          var ue = W[fe];
          ue !== null && (ue.lane &= -536870913);
        }
      i &= ~ve;
    }
    l !== 0 && gi(e, l, 0), u !== 0 && c === 0 && e.tag !== 0 && (e.suspendedLanes |= u & ~(x & ~t));
  }
  function gi(e, t, i) {
    e.pendingLanes |= t, e.suspendedLanes &= ~t;
    var l = 31 - Mt(t);
    e.entangledLanes |= t, e.entanglements[l] = e.entanglements[l] | 1073741824 | i & 261930;
  }
  function Ya(e, t) {
    var i = e.entangledLanes |= t;
    for (e = e.entanglements; i; ) {
      var l = 31 - Mt(i), c = 1 << l;
      c & t | e[l] & t && (e[l] |= t), i &= ~c;
    }
  }
  function rt(e, t) {
    var i = t & -t;
    return i = (i & 42) !== 0 ? 1 : Ui(i), (i & (e.suspendedLanes | t)) !== 0 ? 0 : i;
  }
  function Ui(e) {
    switch (e) {
      case 2:
        e = 1;
        break;
      case 8:
        e = 4;
        break;
      case 32:
        e = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        e = 128;
        break;
      case 268435456:
        e = 134217728;
        break;
      default:
        e = 0;
    }
    return e;
  }
  function ht(e) {
    return e &= -e, 2 < e ? 8 < e ? (e & 134217727) !== 0 ? 32 : 268435456 : 8 : 2;
  }
  function kn() {
    var e = Ne.p;
    return e !== 0 ? e : (e = window.event, e === void 0 ? 32 : Zv(e.type));
  }
  function ea(e, t) {
    var i = Ne.p;
    try {
      return Ne.p = e, t();
    } finally {
      Ne.p = i;
    }
  }
  var oi = Math.random().toString(36).slice(2), qt = "__reactFiber$" + oi, bn = "__reactProps$" + oi, Pe = "__reactContainer$" + oi, ga = "__reactEvents$" + oi, zt = "__reactListeners$" + oi, ta = "__reactHandles$" + oi, na = "__reactResources$" + oi, Bi = "__reactMarker$" + oi, ia = "__reactLoad$" + oi;
  function aa(e) {
    delete e[qt], delete e[bn], delete e[zt], delete e[ta];
  }
  function _i(e) {
    var t;
    if (t = e[qt]) return t;
    for (var i = e.parentNode; i; ) {
      if (t = i[Pe] || i[qt]) {
        if (i = t.alternate, t.child !== null || i !== null && i.child !== null)
          for (e = Cv(e); e !== null; ) {
            if (i = e[qt]) return i;
            e = Cv(e);
          }
        return t;
      }
      e = i, i = e.parentNode;
    }
    return null;
  }
  function Ei(e) {
    if (e = e[qt] || e[Pe]) {
      var t = e.tag;
      if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3)
        return e;
    }
    return null;
  }
  function $i(e) {
    var t = e.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
    throw Error(r(33));
  }
  function jn(e) {
    var t = e[na];
    return t || (t = e[na] = { hoistableStyles: /* @__PURE__ */ new Map(), hoistableScripts: /* @__PURE__ */ new Map() }), t;
  }
  function yt(e) {
    e[Bi] = !0;
  }
  function ci(e) {
    e[ia] = void 0;
  }
  var la = /* @__PURE__ */ new Set(), Ia = {};
  function ui(e, t) {
    Ni(e, t), Ni(e + "Capture", t);
  }
  function Ni(e, t) {
    for (Ia[e] = t, e = 0; e < t.length; e++)
      la.add(t[e]);
  }
  var Xa = RegExp(
    "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"
  ), ya = {}, Ol = {};
  function Dl(e) {
    return fn.call(Ol, e) ? !0 : fn.call(ya, e) ? !1 : Xa.test(e) ? Ol[e] = !0 : (ya[e] = !0, !1);
  }
  var Ke = !1;
  function va() {
    var e = Ke;
    return Ke = !1, e;
  }
  function Un(e, t, i) {
    if (Dl(t))
      if (i === null) e.removeAttribute(t);
      else {
        switch (typeof i) {
          case "undefined":
          case "function":
          case "symbol":
            e.removeAttribute(t);
            return;
          case "boolean":
            var l = t.toLowerCase().slice(0, 5);
            if (l !== "data-" && l !== "aria-") {
              e.removeAttribute(t);
              return;
            }
        }
        e.setAttribute(t, i);
      }
  }
  function hl(e, t, i) {
    if (i === null) e.removeAttribute(t);
    else {
      switch (typeof i) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          e.removeAttribute(t);
          return;
      }
      e.setAttribute(t, i);
    }
  }
  function Pn(e, t, i, l) {
    if (l === null) e.removeAttribute(i);
    else {
      switch (typeof l) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          e.removeAttribute(i);
          return;
      }
      e.setAttributeNS(t, i, l);
    }
  }
  function on(e) {
    switch (typeof e) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return e;
      case "object":
        return e;
      default:
        return "";
    }
  }
  function vs(e) {
    var t = e.type;
    return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
  }
  function sa(e, t, i) {
    var l = Object.getOwnPropertyDescriptor(
      e.constructor.prototype,
      t
    );
    if (!e.hasOwnProperty(t) && typeof l < "u" && typeof l.get == "function" && typeof l.set == "function") {
      var c = l.get, u = l.set;
      return Object.defineProperty(e, t, {
        configurable: !0,
        get: function() {
          return c.call(this);
        },
        set: function(x) {
          i = "" + x, u.call(this, x);
        }
      }), Object.defineProperty(e, t, {
        enumerable: l.enumerable
      }), {
        getValue: function() {
          return i;
        },
        setValue: function(x) {
          i = "" + x;
        },
        stopTracking: function() {
          e._valueTracker = null, delete e[t];
        }
      };
    }
  }
  function xa(e) {
    if (!e._valueTracker) {
      var t = vs(e) ? "checked" : "value";
      e._valueTracker = sa(
        e,
        t,
        "" + e[t]
      );
    }
  }
  function xs(e) {
    if (!e) return !1;
    var t = e._valueTracker;
    if (!t) return !0;
    var i = t.getValue(), l = "";
    return e && (l = vs(e) ? e.checked ? "true" : "false" : e.value), e = l, e !== i ? (t.setValue(e), !0) : !1;
  }
  var rr = /[\n"\\]/g;
  function Bn(e) {
    return e.replace(
      rr,
      function(t) {
        return "\\" + t.charCodeAt(0).toString(16) + " ";
      }
    );
  }
  function qi(e, t, i, l, c, u, x, T) {
    e.name = "", x != null && typeof x != "function" && typeof x != "symbol" && typeof x != "boolean" ? e.type = x : e.removeAttribute("type"), t != null ? x === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + on(t)) : e.value !== "" + on(t) && (e.value = "" + on(t)) : x !== "submit" && x !== "reset" || e.removeAttribute("value"), t != null ? x === "number" && e.value == t ? Sa(e, on(e.value)) : Sa(e, on(t)) : i != null ? Sa(e, on(i)) : l != null && e.removeAttribute("value"), c == null && u != null && (e.defaultChecked = !!u), c != null && (e.checked = c && typeof c != "function" && typeof c != "symbol"), T != null && typeof T != "function" && typeof T != "symbol" && typeof T != "boolean" ? e.name = "" + on(T) : e.removeAttribute("name");
  }
  function ba(e, t, i, l, c, u, x, T) {
    if (u != null && typeof u != "function" && typeof u != "symbol" && typeof u != "boolean" && (e.type = u), t != null || i != null) {
      if (!(u !== "submit" && u !== "reset" || t != null)) {
        xa(e);
        return;
      }
      i = i != null ? "" + on(i) : "", t = t != null ? "" + on(t) : i, T || t === e.value || (e.value = t), e.defaultValue = t;
    }
    l = l ?? c, l = typeof l != "function" && typeof l != "symbol" && !!l, e.checked = T ? e.checked : !!l, e.defaultChecked = !!l, x != null && typeof x != "function" && typeof x != "symbol" && typeof x != "boolean" && (e.name = x), xa(e);
  }
  function Sa(e, t) {
    e.defaultValue !== "" + t && (e.defaultValue = "" + t);
  }
  function Rn(e, t, i, l) {
    if (e = e.options, t) {
      t = {};
      for (var c = 0; c < i.length; c++)
        t["$" + i[c]] = !0;
      for (i = 0; i < e.length; i++)
        c = t.hasOwnProperty("$" + e[i].value), e[i].selected !== c && (e[i].selected = c), c && l && (e[i].defaultSelected = !0);
    } else {
      for (i = "" + on(i), t = null, c = 0; c < e.length; c++) {
        if (e[c].value === i) {
          e[c].selected = !0, l && (e[c].defaultSelected = !0);
          return;
        }
        t !== null || e[c].disabled || (t = e[c]);
      }
      t !== null && (t.selected = !0);
    }
  }
  function Jn(e, t, i) {
    if (t != null && (t = "" + on(t), t !== e.value && (e.value = t), i == null)) {
      e.defaultValue !== t && (e.defaultValue = t);
      return;
    }
    e.defaultValue = i != null ? "" + on(i) : "";
  }
  function Ti(e, t, i, l) {
    if (t == null) {
      if (l != null) {
        if (i != null) throw Error(r(92));
        if (Ce(l)) {
          if (1 < l.length) throw Error(r(93));
          l = l[0];
        }
        i = l;
      }
      i == null && (i = ""), t = i;
    }
    i = on(t), e.defaultValue = i, l = e.textContent, l === i && l !== "" && l !== null && (e.value = l), xa(e);
  }
  function xe(e, t) {
    if (t) {
      var i = e.firstChild;
      if (i && i === e.lastChild && i.nodeType === 3) {
        i.nodeValue = t;
        return;
      }
    }
    e.textContent = t;
  }
  var z = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " "
    )
  );
  function P(e, t, i) {
    var l = t.indexOf("--") === 0;
    i == null || typeof i == "boolean" || i === "" ? l ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : l ? e.setProperty(t, i) : typeof i != "number" || i === 0 || z.has(t) ? t === "float" ? e.cssFloat = i : e[t] = ("" + i).trim() : e[t] = i + "px";
  }
  function be(e, t, i) {
    if (t != null && typeof t != "object")
      throw Error(r(62));
    if (e = e.style, i != null) {
      for (var l in i)
        !i.hasOwnProperty(l) || t != null && t.hasOwnProperty(l) || (l.indexOf("--") === 0 ? e.setProperty(l, "") : l === "float" ? e.cssFloat = "" : e[l] = "", Ke = !0);
      for (var c in t)
        l = t[c], t.hasOwnProperty(c) && i[c] !== l && (P(e, c, l), Ke = !0);
    } else
      for (var u in t)
        t.hasOwnProperty(u) && P(e, u, t[u]);
  }
  function ye(e) {
    if (e.indexOf("-") === -1) return !1;
    switch (e) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var He = /* @__PURE__ */ new Map([
    ["acceptCharset", "accept-charset"],
    ["htmlFor", "for"],
    ["httpEquiv", "http-equiv"],
    ["crossOrigin", "crossorigin"],
    ["accentHeight", "accent-height"],
    ["alignmentBaseline", "alignment-baseline"],
    ["arabicForm", "arabic-form"],
    ["baselineShift", "baseline-shift"],
    ["capHeight", "cap-height"],
    ["clipPath", "clip-path"],
    ["clipRule", "clip-rule"],
    ["colorInterpolation", "color-interpolation"],
    ["colorInterpolationFilters", "color-interpolation-filters"],
    ["colorProfile", "color-profile"],
    ["colorRendering", "color-rendering"],
    ["dominantBaseline", "dominant-baseline"],
    ["enableBackground", "enable-background"],
    ["fillOpacity", "fill-opacity"],
    ["fillRule", "fill-rule"],
    ["floodColor", "flood-color"],
    ["floodOpacity", "flood-opacity"],
    ["fontFamily", "font-family"],
    ["fontSize", "font-size"],
    ["fontSizeAdjust", "font-size-adjust"],
    ["fontStretch", "font-stretch"],
    ["fontStyle", "font-style"],
    ["fontVariant", "font-variant"],
    ["fontWeight", "font-weight"],
    ["glyphName", "glyph-name"],
    ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
    ["glyphOrientationVertical", "glyph-orientation-vertical"],
    ["horizAdvX", "horiz-adv-x"],
    ["horizOriginX", "horiz-origin-x"],
    ["imageRendering", "image-rendering"],
    ["letterSpacing", "letter-spacing"],
    ["lightingColor", "lighting-color"],
    ["markerEnd", "marker-end"],
    ["markerMid", "marker-mid"],
    ["markerStart", "marker-start"],
    ["maskType", "mask-type"],
    ["overlinePosition", "overline-position"],
    ["overlineThickness", "overline-thickness"],
    ["paintOrder", "paint-order"],
    ["panose-1", "panose-1"],
    ["pointerEvents", "pointer-events"],
    ["renderingIntent", "rendering-intent"],
    ["shapeRendering", "shape-rendering"],
    ["stopColor", "stop-color"],
    ["stopOpacity", "stop-opacity"],
    ["strikethroughPosition", "strikethrough-position"],
    ["strikethroughThickness", "strikethrough-thickness"],
    ["strokeDasharray", "stroke-dasharray"],
    ["strokeDashoffset", "stroke-dashoffset"],
    ["strokeLinecap", "stroke-linecap"],
    ["strokeLinejoin", "stroke-linejoin"],
    ["strokeMiterlimit", "stroke-miterlimit"],
    ["strokeOpacity", "stroke-opacity"],
    ["strokeWidth", "stroke-width"],
    ["textAnchor", "text-anchor"],
    ["textDecoration", "text-decoration"],
    ["textRendering", "text-rendering"],
    ["transformOrigin", "transform-origin"],
    ["underlinePosition", "underline-position"],
    ["underlineThickness", "underline-thickness"],
    ["unicodeBidi", "unicode-bidi"],
    ["unicodeRange", "unicode-range"],
    ["unitsPerEm", "units-per-em"],
    ["vAlphabetic", "v-alphabetic"],
    ["vHanging", "v-hanging"],
    ["vIdeographic", "v-ideographic"],
    ["vMathematical", "v-mathematical"],
    ["vectorEffect", "vector-effect"],
    ["vertAdvY", "vert-adv-y"],
    ["vertOriginX", "vert-origin-x"],
    ["vertOriginY", "vert-origin-y"],
    ["wordSpacing", "word-spacing"],
    ["writingMode", "writing-mode"],
    ["xmlnsXlink", "xmlns:xlink"],
    ["xHeight", "x-height"]
  ]), qe = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function Ze(e) {
    return qe.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
  }
  function vt() {
  }
  var fi = null;
  function mn(e) {
    return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
  }
  var Kt = null, yi = null;
  function Sn(e) {
    var t = Ei(e);
    if (t && (e = t.stateNode)) {
      var i = e[bn] || null;
      e: switch (e = t.stateNode, t.type) {
        case "input":
          if (qi(
            e,
            i.value,
            i.defaultValue,
            i.defaultValue,
            i.checked,
            i.defaultChecked,
            i.type,
            i.name
          ), t = i.name, i.type === "radio" && t != null) {
            for (i = e; i.parentNode; ) i = i.parentNode;
            for (i = i.querySelectorAll(
              'input[name="' + Bn(
                "" + t
              ) + '"][type="radio"]'
            ), t = 0; t < i.length; t++) {
              var l = i[t];
              if (l !== e && l.form === e.form) {
                var c = l[bn] || null;
                if (!c) throw Error(r(90));
                qi(
                  l,
                  c.value,
                  c.defaultValue,
                  c.defaultValue,
                  c.checked,
                  c.defaultChecked,
                  c.type,
                  c.name
                );
              }
            }
            for (t = 0; t < i.length; t++)
              l = i[t], l.form === e.form && xs(l);
          }
          break e;
        case "textarea":
          Jn(e, i.value, i.defaultValue);
          break e;
        case "select":
          t = i.value, t != null && Rn(e, !!i.multiple, t, !1);
      }
    }
  }
  var Hl = !1;
  function Gc(e, t, i) {
    if (Hl) return e(t, i);
    Hl = !0;
    try {
      var l = e(t);
      return l;
    } finally {
      if (Hl = !1, (Kt !== null || yi !== null) && (qu(), Kt && (t = Kt, e = yi, yi = Kt = null, Sn(t), e)))
        for (t = 0; t < e.length; t++) Sn(e[t]);
    }
  }
  function wa(e, t) {
    var i = e.stateNode;
    if (i === null) return null;
    var l = i[bn] || null;
    if (l === null) return null;
    i = l[t];
    e: switch (t) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        (l = !l.disabled) || (e = e.type, l = !(e === "button" || e === "input" || e === "select" || e === "textarea")), e = !l;
        break e;
      default:
        e = !1;
    }
    if (e) return null;
    if (i && typeof i != "function")
      throw Error(
        r(231, t, typeof i)
      );
    return i;
  }
  var di = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u"), bs = !1;
  if (di)
    try {
      var ml = {};
      Object.defineProperty(ml, "passive", {
        get: function() {
          bs = !0;
        }
      }), window.addEventListener("test", ml, ml), window.removeEventListener("test", ml, ml);
    } catch {
      bs = !1;
    }
  var Ga = null, or = null, Ll = null;
  function wn() {
    if (Ll) return Ll;
    var e, t = or, i = t.length, l, c = "value" in Ga ? Ga.value : Ga.textContent, u = c.length;
    for (e = 0; e < i && t[e] === c[e]; e++) ;
    var x = i - e;
    for (l = 1; l <= x && t[i - l] === c[u - l]; l++) ;
    return Ll = c.slice(e, 1 < l ? 1 - l : void 0);
  }
  function cr(e) {
    var t = e.keyCode;
    return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
  }
  function ur() {
    return !0;
  }
  function xo() {
    return !1;
  }
  function $n(e) {
    function t(i, l, c, u, x) {
      this._reactName = i, this._targetInst = c, this.type = l, this.nativeEvent = u, this.target = x, this.currentTarget = null;
      for (var T in e)
        e.hasOwnProperty(T) && (i = e[T], this[T] = i ? i(u) : u[T]);
      return this.isDefaultPrevented = (u.defaultPrevented != null ? u.defaultPrevented : u.returnValue === !1) ? ur : xo, this.isPropagationStopped = xo, this;
    }
    return k(t.prototype, {
      preventDefault: function() {
        this.defaultPrevented = !0;
        var i = this.nativeEvent;
        i && (i.preventDefault ? i.preventDefault() : typeof i.returnValue != "unknown" && (i.returnValue = !1), this.isDefaultPrevented = ur);
      },
      stopPropagation: function() {
        var i = this.nativeEvent;
        i && (i.stopPropagation ? i.stopPropagation() : typeof i.cancelBubble != "unknown" && (i.cancelBubble = !0), this.isPropagationStopped = ur);
      },
      persist: function() {
      },
      isPersistent: ur
    }), t;
  }
  var _a = {
    eventPhase: 0,
    bubbles: 0,
    cancelable: 0,
    timeStamp: function(e) {
      return e.timeStamp || Date.now();
    },
    defaultPrevented: 0,
    isTrusted: 0
  }, fr = $n(_a), qn = k({}, _a, { view: 0, detail: 0 }), sd = $n(qn), bo, dr, b, U = k({}, qn, {
    screenX: 0,
    screenY: 0,
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    getModifierState: hi,
    button: 0,
    buttons: 0,
    relatedTarget: function(e) {
      return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
    },
    movementX: function(e) {
      return "movementX" in e ? e.movementX : (e !== b && (b && e.type === "mousemove" ? (bo = e.screenX - b.screenX, dr = e.screenY - b.screenY) : dr = bo = 0, b = e), bo);
    },
    movementY: function(e) {
      return "movementY" in e ? e.movementY : dr;
    }
  }), G = $n(U), re = k({}, U, { dataTransfer: 0 }), F = $n(re), _e = k({}, qn, { relatedTarget: 0 }), Be = $n(_e), De = k({}, _a, {
    animationName: 0,
    elapsedTime: 0,
    pseudoElement: 0
  }), tt = $n(De), On = k({}, _a, {
    clipboardData: function(e) {
      return "clipboardData" in e ? e.clipboardData : window.clipboardData;
    }
  }), Ea = $n(On), ot = k({}, _a, { data: 0 }), Fn = $n(ot), Ci = {
    Esc: "Escape",
    Spacebar: " ",
    Left: "ArrowLeft",
    Up: "ArrowUp",
    Right: "ArrowRight",
    Down: "ArrowDown",
    Del: "Delete",
    Win: "OS",
    Menu: "ContextMenu",
    Apps: "ContextMenu",
    Scroll: "ScrollLock",
    MozPrintableKey: "Unidentified"
  }, Vn = {
    8: "Backspace",
    9: "Tab",
    12: "Clear",
    13: "Enter",
    16: "Shift",
    17: "Control",
    18: "Alt",
    19: "Pause",
    20: "CapsLock",
    27: "Escape",
    32: " ",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    45: "Insert",
    46: "Delete",
    112: "F1",
    113: "F2",
    114: "F3",
    115: "F4",
    116: "F5",
    117: "F6",
    118: "F7",
    119: "F8",
    120: "F9",
    121: "F10",
    122: "F11",
    123: "F12",
    144: "NumLock",
    145: "ScrollLock",
    224: "Meta"
  }, Vi = {
    Alt: "altKey",
    Control: "ctrlKey",
    Meta: "metaKey",
    Shift: "shiftKey"
  };
  function Za(e) {
    var t = this.nativeEvent;
    return t.getModifierState ? t.getModifierState(e) : (e = Vi[e]) ? !!t[e] : !1;
  }
  function hi() {
    return Za;
  }
  var Ai = k({}, qn, {
    key: function(e) {
      if (e.key) {
        var t = Ci[e.key] || e.key;
        if (t !== "Unidentified") return t;
      }
      return e.type === "keypress" ? (e = cr(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? Vn[e.keyCode] || "Unidentified" : "";
    },
    code: 0,
    location: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    repeat: 0,
    locale: 0,
    getModifierState: hi,
    charCode: function(e) {
      return e.type === "keypress" ? cr(e) : 0;
    },
    keyCode: function(e) {
      return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
    },
    which: function(e) {
      return e.type === "keypress" ? cr(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
    }
  }), Ss = $n(Ai), rd = k({}, U, {
    pointerId: 0,
    width: 0,
    height: 0,
    pressure: 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 0,
    isPrimary: 0
  }), cg = $n(rd), Uw = k({}, _a, { submitter: 0 }), Bw = $n(Uw), $w = k({}, qn, {
    touches: 0,
    targetTouches: 0,
    changedTouches: 0,
    altKey: 0,
    metaKey: 0,
    ctrlKey: 0,
    shiftKey: 0,
    getModifierState: hi
  }), qw = $n($w), Vw = k({}, _a, {
    propertyName: 0,
    elapsedTime: 0,
    pseudoElement: 0
  }), Yw = $n(Vw), Iw = k({}, U, {
    deltaX: function(e) {
      return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
    },
    deltaY: function(e) {
      return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
    },
    deltaZ: 0,
    deltaMode: 0
  }), Xw = $n(Iw), Gw = k({}, _a, {
    newState: 0,
    oldState: 0,
    source: 0
  }), Zw = $n(Gw), Qw = [9, 13, 27, 32], od = di && "CompositionEvent" in window, So = null;
  di && "documentMode" in document && (So = document.documentMode);
  var Kw = di && "TextEvent" in window && !So, ug = di && (!od || So && 8 < So && 11 >= So), fg = " ", dg = !1;
  function hg(e, t) {
    switch (e) {
      case "keyup":
        return Qw.indexOf(t.keyCode) !== -1;
      case "keydown":
        return t.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function mg(e) {
    return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
  }
  var hr = !1;
  function Pw(e, t) {
    switch (e) {
      case "compositionend":
        return mg(t);
      case "keypress":
        return t.which !== 32 ? null : (dg = !0, fg);
      case "textInput":
        return e = t.data, e === fg && dg ? null : e;
      default:
        return null;
    }
  }
  function Jw(e, t) {
    if (hr)
      return e === "compositionend" || !od && hg(e, t) ? (e = wn(), Ll = or = Ga = null, hr = !1, e) : null;
    switch (e) {
      case "paste":
        return null;
      case "keypress":
        if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
          if (t.char && 1 < t.char.length)
            return t.char;
          if (t.which) return String.fromCharCode(t.which);
        }
        return null;
      case "compositionend":
        return ug && t.locale !== "ko" ? null : t.data;
      default:
        return null;
    }
  }
  var Fw = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0
  };
  function pg(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return t === "input" ? !!Fw[e.type] : t === "textarea";
  }
  function gg(e, t, i, l) {
    Kt ? yi ? yi.push(l) : yi = [l] : Kt = l, t = Zu(t, "onChange"), 0 < t.length && (i = new fr(
      "onChange",
      "change",
      null,
      i,
      l
    ), e.push({ event: i, listeners: t }));
  }
  var wo = null, _o = null;
  function Ww(e) {
    iv(e, 0);
  }
  function Zc(e) {
    var t = $i(e);
    if (xs(t)) return e;
  }
  function yg(e, t) {
    if (e === "change") return t;
  }
  var vg = !1;
  if (di) {
    var cd;
    if (di) {
      var ud = "oninput" in document;
      if (!ud) {
        var xg = document.createElement("div");
        xg.setAttribute("oninput", "return;"), ud = typeof xg.oninput == "function";
      }
      cd = ud;
    } else cd = !1;
    vg = cd && (!document.documentMode || 9 < document.documentMode);
  }
  function bg() {
    wo && (wo.detachEvent("onpropertychange", Sg), _o = wo = null);
  }
  function Sg(e) {
    if (e.propertyName === "value" && Zc(_o)) {
      var t = [];
      gg(
        t,
        _o,
        e,
        mn(e)
      ), Gc(Ww, t);
    }
  }
  function e_(e, t, i) {
    e === "focusin" ? (bg(), wo = t, _o = i, wo.attachEvent("onpropertychange", Sg)) : e === "focusout" && bg();
  }
  function t_(e) {
    if (e === "selectionchange" || e === "keyup" || e === "keydown")
      return Zc(_o);
  }
  function n_(e, t) {
    if (e === "click") return Zc(t);
  }
  function i_(e, t) {
    if (e === "input" || e === "change")
      return Zc(t);
  }
  function a_(e, t) {
    return e === t && (e !== 0 || 1 / e === 1 / t) || e !== e && t !== t;
  }
  var Yi = typeof Object.is == "function" ? Object.is : a_;
  function Eo(e, t) {
    if (Yi(e, t)) return !0;
    if (typeof e != "object" || e === null || typeof t != "object" || t === null)
      return !1;
    var i = Object.keys(e), l = Object.keys(t);
    if (i.length !== l.length) return !1;
    for (l = 0; l < i.length; l++) {
      var c = i[l];
      if (!fn.call(t, c) || !Yi(e[c], t[c]))
        return !1;
    }
    return !0;
  }
  function fd(e) {
    if (e = e || (typeof document < "u" ? document : void 0), typeof e > "u") return null;
    try {
      return e.activeElement || e.body;
    } catch {
      return e.body;
    }
  }
  function wg(e) {
    for (; e && e.firstChild; ) e = e.firstChild;
    return e;
  }
  function _g(e, t) {
    var i = wg(e);
    e = 0;
    for (var l; i; ) {
      if (i.nodeType === 3) {
        if (l = e + i.textContent.length, e <= t && l >= t)
          return { node: i, offset: t - e };
        e = l;
      }
      e: {
        for (; i; ) {
          if (i.nextSibling) {
            i = i.nextSibling;
            break e;
          }
          i = i.parentNode;
        }
        i = void 0;
      }
      i = wg(i);
    }
  }
  function Eg(e, t) {
    return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? Eg(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
  }
  function Ng(e) {
    e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
    for (var t = fd(e.document); t instanceof e.HTMLIFrameElement; ) {
      try {
        var i = typeof t.contentWindow.location.href == "string";
      } catch {
        i = !1;
      }
      if (i) e = t.contentWindow;
      else break;
      t = fd(e.document);
    }
    return t;
  }
  function dd(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
  }
  var l_ = di && "documentMode" in document && 11 >= document.documentMode, mr = null, hd = null, No = null, md = !1;
  function Tg(e, t, i) {
    var l = i.window === i ? i.document : i.nodeType === 9 ? i : i.ownerDocument;
    md || mr == null || mr !== fd(l) || (l = mr, "selectionStart" in l && dd(l) ? l = { start: l.selectionStart, end: l.selectionEnd } : (l = (l.ownerDocument && l.ownerDocument.defaultView || window).getSelection(), l = {
      anchorNode: l.anchorNode,
      anchorOffset: l.anchorOffset,
      focusNode: l.focusNode,
      focusOffset: l.focusOffset
    }), No && Eo(No, l) || (No = l, l = Zu(hd, "onSelect"), 0 < l.length && (t = new fr(
      "onSelect",
      "select",
      null,
      t,
      i
    ), e.push({ event: t, listeners: l }), t.target = mr)));
  }
  function ws(e, t) {
    var i = {};
    return i[e.toLowerCase()] = t.toLowerCase(), i["Webkit" + e] = "webkit" + t, i["Moz" + e] = "moz" + t, i;
  }
  var pr = {
    animationend: ws("Animation", "AnimationEnd"),
    animationiteration: ws("Animation", "AnimationIteration"),
    animationstart: ws("Animation", "AnimationStart"),
    transitionrun: ws("Transition", "TransitionRun"),
    transitionstart: ws("Transition", "TransitionStart"),
    transitioncancel: ws("Transition", "TransitionCancel"),
    transitionend: ws("Transition", "TransitionEnd")
  }, pd = {}, Cg = {};
  di && (Cg = document.createElement("div").style, "AnimationEvent" in window || (delete pr.animationend.animation, delete pr.animationiteration.animation, delete pr.animationstart.animation), "TransitionEvent" in window || delete pr.transitionend.transition);
  function _s(e) {
    if (pd[e]) return pd[e];
    if (!pr[e]) return e;
    var t = pr[e], i;
    for (i in t)
      if (t.hasOwnProperty(i) && i in Cg)
        return pd[e] = t[i];
    return e;
  }
  var Ag = _s("animationend"), Mg = _s("animationiteration"), zg = _s("animationstart"), s_ = _s("transitionrun"), r_ = _s("transitionstart"), o_ = _s("transitioncancel"), kg = _s("transitionend"), jg = /* @__PURE__ */ new Map(), gd = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
    " "
  );
  gd.push("scrollEnd");
  function Na(e, t) {
    jg.set(e, t), ui(t, [e]);
  }
  var c_ = 0;
  function pl(e, t) {
    if (e.name != null && e.name !== "auto") return e.name;
    if (t.autoName !== null) return t.autoName;
    e = Ma.identifierPrefix;
    var i = c_++;
    return e = "_" + e + "t_" + i.toString(32) + "_", t.autoName = e;
  }
  function Rg(e) {
    if (e == null || typeof e == "string")
      return e;
    var t = null, i = Dr;
    if (i !== null)
      for (var l = 0; l < i.length; l++) {
        var c = e[i[l]];
        if (c != null) {
          if (c === "none") return "none";
          t = t == null ? c : t + (" " + c);
        }
      }
    return t ?? e.default;
  }
  function gl(e, t) {
    return e = Rg(e), t = Rg(t), t == null ? e === "auto" ? null : e : t === "auto" ? null : t;
  }
  var Qc = typeof reportError == "function" ? reportError : function(e) {
    if (typeof window == "object" && typeof window.ErrorEvent == "function") {
      var t = new window.ErrorEvent("error", {
        bubbles: !0,
        cancelable: !0,
        message: typeof e == "object" && e !== null && typeof e.message == "string" ? String(e.message) : String(e),
        error: e
      });
      if (!window.dispatchEvent(t)) return;
    } else if (typeof process == "object" && typeof process.emit == "function") {
      process.emit("uncaughtException", e);
      return;
    }
    console.error(e);
  }, ra = [], gr = 0, yd = 0;
  function Kc() {
    for (var e = gr, t = yd = gr = 0; t < e; ) {
      var i = ra[t];
      ra[t++] = null;
      var l = ra[t];
      ra[t++] = null;
      var c = ra[t];
      ra[t++] = null;
      var u = ra[t];
      if (ra[t++] = null, l !== null && c !== null) {
        var x = l.pending;
        x === null ? c.next = c : (c.next = x.next, x.next = c), l.pending = c;
      }
      u !== 0 && Og(i, c, u);
    }
  }
  function Pc(e, t, i, l) {
    ra[gr++] = e, ra[gr++] = t, ra[gr++] = i, ra[gr++] = l, yd |= l, e.lanes |= l, e = e.alternate, e !== null && (e.lanes |= l);
  }
  function vd(e, t, i, l) {
    return Pc(e, t, i, l), Jc(e);
  }
  function Es(e, t) {
    return Pc(e, null, null, t), Jc(e);
  }
  function Og(e, t, i) {
    e.lanes |= i;
    var l = e.alternate;
    l !== null && (l.lanes |= i);
    for (var c = !1, u = e.return; u !== null; )
      u.childLanes |= i, l = u.alternate, l !== null && (l.childLanes |= i), u.tag === 22 && (e = u.stateNode, e === null || e._visibility & 1 || (c = !0)), e = u, u = u.return;
    return e.tag === 3 ? (u = e.stateNode, c && t !== null && (c = 31 - Mt(i), e = u.hiddenUpdates, l = e[c], l === null ? e[c] = [t] : l.push(t), t.lane = i | 536870912), u) : null;
  }
  function Jc(e) {
    if (50 < Zo)
      throw Zo = 0, $u = null, Error(r(185));
    for (var t = e.return; t !== null; )
      e = t, t = e.return;
    return e.tag === 3 ? e.stateNode : null;
  }
  var yr = {};
  function u_(e, t, i, l) {
    this.tag = e, this.key = i, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = l, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
  }
  function Mi(e, t, i, l) {
    return new u_(e, t, i, l);
  }
  function xd(e) {
    return e = e.prototype, !(!e || !e.isReactComponent);
  }
  function yl(e, t) {
    var i = e.alternate;
    return i === null ? (i = Mi(
      e.tag,
      t,
      e.key,
      e.mode
    ), i.elementType = e.elementType, i.type = e.type, i.stateNode = e.stateNode, i.alternate = e, e.alternate = i) : (i.pendingProps = t, i.type = e.type, i.flags = 0, i.subtreeFlags = 0, i.deletions = null), i.flags = e.flags & 1206910976, i.childLanes = e.childLanes, i.lanes = e.lanes, i.child = e.child, i.memoizedProps = e.memoizedProps, i.memoizedState = e.memoizedState, i.updateQueue = e.updateQueue, t = e.dependencies, i.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }, i.sibling = e.sibling, i.index = e.index, i.ref = e.ref, i.refCleanup = e.refCleanup, i;
  }
  function Dg(e, t) {
    e.flags &= 1206910978;
    var i = e.alternate;
    return i === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = i.childLanes, e.lanes = i.lanes, e.child = i.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = i.memoizedProps, e.memoizedState = i.memoizedState, e.updateQueue = i.updateQueue, e.type = i.type, t = i.dependencies, e.dependencies = t === null ? null : {
      lanes: t.lanes,
      firstContext: t.firstContext
    }), e;
  }
  function Fc(e, t, i, l, c, u) {
    var x = 0;
    if (l = e, typeof l == "function") xd(l) && (x = 1);
    else if (typeof l == "string")
      x = U2(
        e,
        i,
        _t.current
      ) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
    else
      e: switch (l) {
        case ae:
          return e = Mi(31, i, t, c), e.elementType = ae, e.lanes = u, e;
        case ee:
          return Ns(i.children, c, u, t);
        case me:
          x = 8, c |= 24;
          break;
        case te:
          return e = Mi(12, i, t, c | 2), e.elementType = te, e.lanes = u, e;
        case B:
          return e = Mi(13, i, t, c), e.elementType = B, e.lanes = u, e;
        case X:
          return e = Mi(19, i, t, c), e.elementType = X, e.lanes = u, e;
        case he:
        case L:
          return e = c | 32, e = Mi(30, i, t, e), e.elementType = L, e.lanes = u, e.stateNode = {
            autoName: null,
            paired: null,
            clones: null,
            ref: null
          }, e;
        default:
          if (typeof l == "object" && l !== null)
            switch (l.$$typeof) {
              case Y:
                x = 10;
                break e;
              case O:
                x = 9;
                break e;
              case j:
                x = 11;
                break e;
              case J:
                x = 14;
                break e;
              case I:
                x = 16, l = null;
                break e;
            }
          x = 29, i = Error(
            r(130, e === null ? "null" : typeof e, "")
          ), l = null;
      }
    return t = Mi(x, i, t, c), t.elementType = e, t.type = l, t.lanes = u, t;
  }
  function Ns(e, t, i, l) {
    return e = Mi(7, e, l, t), e.lanes = i, e;
  }
  function bd(e, t, i) {
    return e = Mi(6, e, null, t), e.lanes = i, e;
  }
  function Hg(e) {
    var t = Mi(18, null, null, 0);
    return t.stateNode = e, t;
  }
  function Sd(e, t, i) {
    return t = Mi(
      4,
      e.children !== null ? e.children : [],
      e.key,
      t
    ), t.lanes = i, t.stateNode = {
      containerInfo: e.containerInfo,
      pendingChildren: null,
      implementation: e.implementation
    }, t;
  }
  var Lg = /* @__PURE__ */ new WeakMap();
  function oa(e, t) {
    if (typeof e == "object" && e !== null) {
      var i = Lg.get(e);
      return i !== void 0 ? i : (t = {
        value: e,
        source: t,
        stack: Qn(t)
      }, Lg.set(e, t), t);
    }
    return {
      value: e,
      source: t,
      stack: Qn(t)
    };
  }
  var vr = [], xr = 0, Wc = null, To = 0, ca = [], ua = 0, Ul = null, Qa = 1, Ka = "";
  function vl(e, t) {
    vr[xr++] = To, vr[xr++] = Wc, Wc = e, To = t;
  }
  function Ug(e, t, i) {
    ca[ua++] = Qa, ca[ua++] = Ka, ca[ua++] = Ul, Ul = e;
    var l = Qa;
    e = Ka;
    var c = 32 - Mt(l) - 1;
    l &= ~(1 << c), i += 1;
    var u = 32 - Mt(t) + c;
    if (30 < u) {
      var x = c - c % 5;
      u = (l & (1 << x) - 1).toString(32), l >>= x, c -= x, Qa = 1 << 32 - Mt(t) + c | i << c | l, Ka = u + e;
    } else
      Qa = 1 << u | i << c | l, Ka = e;
  }
  function eu(e) {
    e.return !== null && (vl(e, 1), Ug(e, 1, 0));
  }
  function wd(e) {
    for (; e === Wc; )
      Wc = vr[--xr], vr[xr] = null, To = vr[--xr], vr[xr] = null;
    for (; e === Ul; )
      Ul = ca[--ua], ca[ua] = null, Ka = ca[--ua], ca[ua] = null, Qa = ca[--ua], ca[ua] = null;
  }
  function Bg(e, t) {
    ca[ua++] = Qa, ca[ua++] = Ka, ca[ua++] = Ul, Qa = t.id, Ka = t.overflow, Ul = e;
  }
  var Yn = null, Vt = null, nt = !1, Bl = null, fa = !1, _d = Error(r(519));
  function $l(e) {
    var t = Error(
      r(
        418,
        1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML",
        ""
      )
    );
    throw Co(oa(t, e)), _d;
  }
  function $g(e) {
    var t = e.stateNode, i = e.type, l = e.memoizedProps;
    switch (t[qt] = e, t[bn] = l, i) {
      case "dialog":
        st("cancel", t), st("close", t);
        break;
      case "iframe":
      case "object":
      case "embed":
        st("load", t);
        break;
      case "video":
      case "audio":
        for (i = 0; i < Ko.length; i++)
          st(Ko[i], t);
        break;
      case "source":
        st("error", t);
        break;
      case "img":
      case "image":
      case "link":
        st("error", t), st("load", t);
        break;
      case "details":
        st("toggle", t);
        break;
      case "input":
        st("invalid", t), ba(
          t,
          l.value,
          l.defaultValue,
          l.checked,
          l.defaultChecked,
          l.type,
          l.name,
          !0
        );
        break;
      case "select":
        st("invalid", t);
        break;
      case "textarea":
        st("invalid", t), Ti(t, l.value, l.defaultValue, l.children);
    }
    i = l.children, typeof i != "string" && typeof i != "number" && typeof i != "bigint" || t.textContent === "" + i || l.suppressHydrationWarning === !0 || rv(t.textContent, i) ? (l.popover != null && (st("beforetoggle", t), st("toggle", t)), l.onScroll != null && st("scroll", t), l.onScrollEnd != null && st("scrollend", t), l.onClick != null && (t.onclick = vt), t = !0) : t = !1, t || $l(e, !0);
  }
  function tu(e) {
    for (Yn = e.return; Yn; )
      switch (Yn.tag) {
        case 5:
        case 31:
        case 13:
          fa = !1;
          return;
        case 27:
        case 3:
          fa = !0;
          return;
        default:
          Yn = Yn.return;
      }
  }
  function br(e) {
    if (e !== Yn) return !1;
    if (!nt) return tu(e), nt = !0, !1;
    var t = e.tag, i;
    if ((i = t !== 3 && t !== 27) && ((i = t === 5) && (i = e.type, i = !(i !== "form" && i !== "button") || Wh(e.type, e.memoizedProps)), i = !i), i && Vt && $l(e), tu(e), t === 13) {
      if (e = e.memoizedState, e = e !== null ? e.dehydrated : null, !e) throw Error(r(317));
      Vt = Tv(e);
    } else if (t === 31) {
      if (e = e.memoizedState, e = e !== null ? e.dehydrated : null, !e) throw Error(r(317));
      Vt = Tv(e);
    } else
      t === 27 ? (t = Vt, ns(e.type) ? (e = om, om = null, Vt = e) : Vt = t) : Vt = Yn ? ha(e.stateNode.nextSibling) : null;
    return !0;
  }
  function Ts() {
    Vt = Yn = null, nt = !1;
  }
  function Ed() {
    var e = Bl;
    return e !== null && (ji === null ? ji = e : ji.push.apply(
      ji,
      e
    ), Bl = null), e;
  }
  function Co(e) {
    Bl === null ? Bl = [e] : Bl.push(e);
  }
  var Nd = Me(null), Cs = null, xl = null;
  function ql(e, t, i) {
    Re(Nd, t._currentValue), t._currentValue = i;
  }
  function bl(e) {
    e._currentValue = Nd.current, Ge(Nd);
  }
  function nu(e, t, i) {
    for (; e !== null; ) {
      var l = e.alternate;
      if ((e.childLanes & t) !== t ? (e.childLanes |= t, l !== null && (l.childLanes |= t)) : l !== null && (l.childLanes & t) !== t && (l.childLanes |= t), e === i) break;
      e = e.return;
    }
  }
  function Td(e, t, i, l) {
    var c = e.child;
    for (c !== null && (c.return = e); c !== null; ) {
      var u = c.dependencies;
      if (u !== null) {
        var x = c.child;
        u = u.firstContext;
        e: for (; u !== null; ) {
          var T = u;
          u = c;
          for (var $ = 0; $ < t.length; $++)
            if (T.context === t[$]) {
              u.lanes |= i, T = u.alternate, T !== null && (T.lanes |= i), nu(
                u.return,
                i,
                e
              ), l || (x = null);
              break e;
            }
          u = T.next;
        }
      } else if (c.tag === 18) {
        if (x = c.return, x === null) throw Error(r(341));
        x.lanes |= i, u = x.alternate, u !== null && (u.lanes |= i), nu(x, i, e), x = null;
      } else
        c.tag === 13 && c.memoizedState !== null && c.memoizedState.dehydrated === null ? (c.lanes |= i, x = c.alternate, x !== null && (x.lanes |= i), nu(
          c.return,
          i,
          e
        ), x = c.child, x = x !== null ? x.sibling : null) : x = c.child;
      if (x !== null) x.return = c;
      else
        for (x = c; x !== null; ) {
          if (x === e) {
            x = null;
            break;
          }
          if (c = x.sibling, c !== null) {
            c.return = x.return, x = c;
            break;
          }
          x = x.return;
        }
      c = x;
    }
  }
  function As(e, t, i, l) {
    e = null;
    for (var c = t, u = !1; c !== null; ) {
      if (!u) {
        if ((c.flags & 524288) !== 0) u = !0;
        else if ((c.flags & 262144) !== 0) break;
      }
      if (c.tag === 10) {
        var x = c.alternate;
        if (x === null) throw Error(r(387));
        if (x = x.memoizedProps, x !== null) {
          var T = c.type;
          Yi(c.pendingProps.value, x.value) || (e !== null ? e.push(T) : e = [T]);
        }
      } else if (c === Mn.current) {
        if (x = c.alternate, x === null) throw Error(r(387));
        x.memoizedState.memoizedState !== c.memoizedState.memoizedState && (e !== null ? e.push(Xr) : e = [Xr]);
      }
      c = c.return;
    }
    return e !== null && Td(
      t,
      e,
      i,
      l
    ), t.flags |= 262144, e !== null;
  }
  function iu(e) {
    for (e = e.firstContext; e !== null; ) {
      if (!Yi(
        e.context._currentValue,
        e.memoizedValue
      ))
        return !0;
      e = e.next;
    }
    return !1;
  }
  function Ms(e) {
    Cs = e, xl = null, e = e.dependencies, e !== null && (e.firstContext = null);
  }
  function Wn(e) {
    return qg(Cs, e);
  }
  function au(e, t) {
    return Cs === null && Ms(e), qg(e, t);
  }
  function qg(e, t) {
    var i = t._currentValue;
    if (t = { context: t, memoizedValue: i, next: null }, xl === null) {
      if (e === null) throw Error(r(308));
      xl = t, e.dependencies = { lanes: 0, firstContext: t }, e.flags |= 524288;
    } else xl = xl.next = t;
    return i;
  }
  var f_ = typeof AbortController < "u" ? AbortController : function() {
    var e = [], t = this.signal = {
      aborted: !1,
      addEventListener: function(i, l) {
        e.push(l);
      }
    };
    this.abort = function() {
      t.aborted = !0, e.forEach(function(i) {
        return i();
      });
    };
  }, d_ = n.unstable_scheduleCallback, h_ = n.unstable_NormalPriority, _n = {
    $$typeof: Y,
    Consumer: null,
    Provider: null,
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0
  };
  function Cd() {
    return {
      controller: new f_(),
      data: /* @__PURE__ */ new Map(),
      refCount: 0
    };
  }
  function Ao(e) {
    e.refCount--, e.refCount === 0 && d_(h_, function() {
      e.controller.abort();
    });
  }
  function Vg(e, t) {
    if ((e.pendingLanes & 4194048) !== 0) {
      var i = e.transitionTypes;
      for (i === null && (i = e.transitionTypes = []), e = 0; e < t.length; e++) {
        var l = t[e];
        i.indexOf(l) === -1 && i.push(l);
      }
    }
  }
  var Mo = null;
  function m_(e) {
    var t = e.transitionTypes;
    return e.transitionTypes = null, t;
  }
  var zo = null, Ad = 0, zs = 0, Sr = null;
  function p_(e, t) {
    if (zo === null) {
      var i = zo = [];
      Ad = 0, zs = Ih(), Sr = {
        status: "pending",
        value: void 0,
        then: function(l) {
          i.push(l);
        }
      };
    }
    return Ad++, t.then(Yg, Yg), t;
  }
  function Yg() {
    if (--Ad === 0 && (Mo = null, zo !== null)) {
      Sr !== null && (Sr.status = "fulfilled");
      var e = zo;
      zo = null, zs = 0, Sr = null;
      for (var t = 0; t < e.length; t++) (0, e[t])();
    }
  }
  function g_(e, t) {
    var i = [], l = {
      status: "pending",
      value: null,
      reason: null,
      then: function(c) {
        i.push(c);
      }
    };
    return e.then(
      function() {
        l.status = "fulfilled", l.value = t;
        for (var c = 0; c < i.length; c++) (0, i[c])(t);
      },
      function(c) {
        for (l.status = "rejected", l.reason = c, c = 0; c < i.length; c++)
          (0, i[c])(void 0);
      }
    ), l;
  }
  var Ig = we.S;
  we.S = function(e, t) {
    if (Hy = Zt(), typeof t == "object" && t !== null && typeof t.then == "function" && p_(e, t), Mo !== null)
      for (var i = Br; i !== null; )
        Vg(i, Mo), i = i.next;
    if (i = e.types, i !== null) {
      for (var l = Br; l !== null; )
        Vg(l, i), l = l.next;
      if (zs !== 0) {
        l = Mo, l === null && (l = Mo = []);
        for (var c = 0; c < i.length; c++) {
          var u = i[c];
          l.indexOf(u) === -1 && l.push(u);
        }
      }
    }
    Ig !== null && Ig(e, t);
  };
  var ks = Me(null);
  function Md() {
    var e = ks.current;
    return e !== null ? e : Ut.pooledCache;
  }
  function lu(e, t) {
    t === null ? Re(ks, ks.current) : Re(ks, t.pool);
  }
  function Xg() {
    var e = Md();
    return e === null ? null : { parent: _n._currentValue, pool: e };
  }
  var wr = Error(r(460)), zd = Error(r(474)), su = Error(r(542)), ru = { then: function() {
  } };
  function Gg(e) {
    return e = e.status, e === "fulfilled" || e === "rejected";
  }
  function Zg(e, t, i) {
    switch (i = e[i], i === void 0 ? e.push(t) : i !== t && (t.then(vt, vt), t = i), t.status) {
      case "fulfilled":
        return t.value;
      case "rejected":
        throw e = t.reason, Kg(e), e === void 0 && !("reason" in t) ? Error(r(600)) : e;
      default:
        if (typeof t.status == "string") t.then(vt, vt);
        else {
          if (e = Ut, e !== null && 100 < e.shellSuspendCounter)
            throw Error(r(482));
          e = t, e.status = "pending", e.then(
            function(l) {
              if (t.status === "pending") {
                var c = t;
                c.status = "fulfilled", c.value = l;
              }
            },
            function(l) {
              if (t.status === "pending") {
                var c = t;
                c.status = "rejected", c.reason = l;
              }
            }
          );
        }
        switch (t.status) {
          case "fulfilled":
            return t.value;
          case "rejected":
            throw e = t.reason, Kg(e), e;
        }
        throw Rs = t, wr;
    }
  }
  function js(e) {
    try {
      var t = e._init;
      return t(e._payload);
    } catch (i) {
      throw i !== null && typeof i == "object" && typeof i.then == "function" ? (Rs = i, wr) : i;
    }
  }
  var Rs = null;
  function Qg() {
    if (Rs === null) throw Error(r(459));
    var e = Rs;
    return Rs = null, e;
  }
  function Kg(e) {
    if (e === wr || e === su)
      throw Error(r(483));
  }
  var _r = null, ko = 0;
  function ou(e) {
    var t = ko;
    return ko += 1, _r === null && (_r = []), Zg(_r, e, t);
  }
  function Vl(e, t) {
    t = t.props.ref, e.ref = t !== void 0 ? t : null;
  }
  function cu(e, t) {
    throw t.$$typeof === H ? Error(r(525)) : (e = Object.prototype.toString.call(t), Error(
      r(
        31,
        e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e
      )
    ));
  }
  function Pg(e) {
    function t(ne, Z) {
      if (e) {
        var se = ne.deletions;
        se === null ? (ne.deletions = [Z], ne.flags |= 16) : se.push(Z);
      }
    }
    function i(ne, Z) {
      if (!e) return null;
      for (; Z !== null; )
        t(ne, Z), Z = Z.sibling;
      return null;
    }
    function l(ne) {
      for (var Z = /* @__PURE__ */ new Map(); ne !== null; )
        ne.key === null ? Z.set(ne.index, ne) : Z.set(ne.key, ne), ne = ne.sibling;
      return Z;
    }
    function c(ne, Z) {
      return ne = yl(ne, Z), ne.index = 0, ne.sibling = null, ne;
    }
    function u(ne, Z, se) {
      return ne.index = se, e ? (se = ne.alternate, se !== null ? (se = se.index, se < Z ? (ne.flags |= 2, Z) : se) : (ne.flags |= 134217730, Z)) : (ne.flags |= 1048576, Z);
    }
    function x(ne) {
      return e && ne.alternate === null && (ne.flags |= 134217730), ne;
    }
    function T(ne, Z, se, ge) {
      return Z === null || Z.tag !== 6 ? (Z = bd(se, ne.mode, ge), Z.return = ne, Z) : (Z = c(Z, se), Z.return = ne, Z);
    }
    function $(ne, Z, se, ge) {
      var je = se.type;
      return je === ee ? (ne = fe(
        ne,
        Z,
        se.props.children,
        ge,
        se.key
      ), Vl(ne, se), ne) : Z !== null && (Z.elementType === je || typeof je == "object" && je !== null && je.$$typeof === I && js(je) === Z.type) ? (Z = c(Z, se.props), Vl(Z, se), Z.return = ne, Z) : (Z = Fc(
        se.type,
        se.key,
        se.props,
        null,
        ne.mode,
        ge
      ), Vl(Z, se), Z.return = ne, Z);
    }
    function ie(ne, Z, se, ge) {
      return Z === null || Z.tag !== 4 || Z.stateNode.containerInfo !== se.containerInfo || Z.stateNode.implementation !== se.implementation ? (Z = Sd(se, ne.mode, ge), Z.return = ne, Z) : (Z = c(Z, se.children || []), Z.return = ne, Z);
    }
    function fe(ne, Z, se, ge, je) {
      return Z === null || Z.tag !== 7 ? (Z = Ns(
        se,
        ne.mode,
        ge,
        je
      ), Z.return = ne, Z) : (Z = c(Z, se), Z.return = ne, Z);
    }
    function ve(ne, Z, se) {
      if (typeof Z == "string" && Z !== "" || typeof Z == "number" || typeof Z == "bigint")
        return Z = bd(
          "" + Z,
          ne.mode,
          se
        ), Z.return = ne, Z;
      if (typeof Z == "object" && Z !== null) {
        switch (Z.$$typeof) {
          case q:
            return se = Fc(
              Z.type,
              Z.key,
              Z.props,
              null,
              ne.mode,
              se
            ), Vl(se, Z), se.return = ne, se;
          case de:
            return Z = Sd(
              Z,
              ne.mode,
              se
            ), Z.return = ne, Z;
          case I:
            return Z = js(Z), ve(ne, Z, se);
        }
        if (Ce(Z) || Se(Z))
          return Z = Ns(
            Z,
            ne.mode,
            se,
            null
          ), Z.return = ne, Z;
        if (typeof Z.then == "function")
          return ve(ne, ou(Z), se);
        if (Z.$$typeof === Y)
          return ve(
            ne,
            au(ne, Z),
            se
          );
        cu(ne, Z);
      }
      return null;
    }
    function W(ne, Z, se, ge) {
      var je = Z !== null ? Z.key : null;
      if (typeof se == "string" && se !== "" || typeof se == "number" || typeof se == "bigint")
        return je !== null ? null : T(ne, Z, "" + se, ge);
      if (typeof se == "object" && se !== null) {
        switch (se.$$typeof) {
          case q:
            return se.key === je ? $(ne, Z, se, ge) : null;
          case de:
            return se.key === je ? ie(ne, Z, se, ge) : null;
          case I:
            return se = js(se), W(ne, Z, se, ge);
        }
        if (Ce(se) || Se(se))
          return je !== null ? null : fe(ne, Z, se, ge, null);
        if (typeof se.then == "function")
          return W(
            ne,
            Z,
            ou(se),
            ge
          );
        if (se.$$typeof === Y)
          return W(
            ne,
            Z,
            au(ne, se),
            ge
          );
        cu(ne, se);
      }
      return null;
    }
    function ue(ne, Z, se, ge, je) {
      if (typeof ge == "string" && ge !== "" || typeof ge == "number" || typeof ge == "bigint")
        return ne = ne.get(se) || null, T(Z, ne, "" + ge, je);
      if (typeof ge == "object" && ge !== null) {
        switch (ge.$$typeof) {
          case q:
            return ne = ne.get(
              ge.key === null ? se : ge.key
            ) || null, $(Z, ne, ge, je);
          case de:
            return ne = ne.get(
              ge.key === null ? se : ge.key
            ) || null, ie(Z, ne, ge, je);
          case I:
            return ge = js(ge), ue(
              ne,
              Z,
              se,
              ge,
              je
            );
        }
        if (Ce(ge) || Se(ge))
          return ne = ne.get(se) || null, fe(Z, ne, ge, je, null);
        if (typeof ge.then == "function")
          return ue(
            ne,
            Z,
            se,
            ou(ge),
            je
          );
        if (ge.$$typeof === Y)
          return ue(
            ne,
            Z,
            se,
            au(Z, ge),
            je
          );
        cu(Z, ge);
      }
      return null;
    }
    function Ae(ne, Z, se, ge) {
      for (var je = null, ut = null, Le = Z, Ie = Z = 0, Tn = null; Le !== null && Ie < se.length; Ie++) {
        Le.index > Ie ? (Tn = Le, Le = null) : Tn = Le.sibling;
        var mt = W(
          ne,
          Le,
          se[Ie],
          ge
        );
        if (mt === null) {
          Le === null && (Le = Tn);
          break;
        }
        e && Le && mt.alternate === null && t(ne, Le), Z = u(mt, Z, Ie), ut === null ? je = mt : ut.sibling = mt, ut = mt, Le = Tn;
      }
      if (Ie === se.length)
        return i(ne, Le), nt && vl(ne, Ie), je;
      if (Le === null) {
        for (; Ie < se.length; Ie++)
          Le = ve(ne, se[Ie], ge), Le !== null && (Z = u(
            Le,
            Z,
            Ie
          ), ut === null ? je = Le : ut.sibling = Le, ut = Le);
        return nt && vl(ne, Ie), je;
      }
      for (Le = l(Le); Ie < se.length; Ie++)
        Tn = ue(
          Le,
          ne,
          Ie,
          se[Ie],
          ge
        ), Tn !== null && (e && (mt = Tn.alternate, mt !== null && Le.delete(mt.key === null ? Ie : mt.key)), Z = u(
          Tn,
          Z,
          Ie
        ), ut === null ? je = Tn : ut.sibling = Tn, ut = Tn);
      return e && Le.forEach(function(rs) {
        return t(ne, rs);
      }), nt && vl(ne, Ie), je;
    }
    function Oe(ne, Z, se, ge) {
      if (se == null) throw Error(r(151));
      for (var je = null, ut = null, Le = Z, Ie = Z = 0, Tn = null, mt = se.next(); Le !== null && !mt.done; Ie++, mt = se.next()) {
        Le.index > Ie ? (Tn = Le, Le = null) : Tn = Le.sibling;
        var rs = W(ne, Le, mt.value, ge);
        if (rs === null) {
          Le === null && (Le = Tn);
          break;
        }
        e && Le && rs.alternate === null && t(ne, Le), Z = u(rs, Z, Ie), ut === null ? je = rs : ut.sibling = rs, ut = rs, Le = Tn;
      }
      if (mt.done)
        return i(ne, Le), nt && vl(ne, Ie), je;
      if (Le === null) {
        for (; !mt.done; Ie++, mt = se.next())
          mt = ve(ne, mt.value, ge), mt !== null && (Z = u(mt, Z, Ie), ut === null ? je = mt : ut.sibling = mt, ut = mt);
        return nt && vl(ne, Ie), je;
      }
      for (Le = l(Le); !mt.done; Ie++, mt = se.next())
        mt = ue(Le, ne, Ie, mt.value, ge), mt !== null && (e && (Tn = mt.alternate, Tn !== null && Le.delete(
          Tn.key === null ? Ie : Tn.key
        )), Z = u(mt, Z, Ie), ut === null ? je = mt : ut.sibling = mt, ut = mt);
      return e && Le.forEach(function(P2) {
        return t(ne, P2);
      }), nt && vl(ne, Ie), je;
    }
    function et(ne, Z, se, ge) {
      if (typeof se == "object" && se !== null && se.type === ee && se.key === null && se.props.ref === void 0 && (se = se.props.children), typeof se == "object" && se !== null) {
        switch (se.$$typeof) {
          case q:
            e: {
              for (var je = se.key; Z !== null; ) {
                if (Z.key === je) {
                  if (je = se.type, je === ee) {
                    if (Z.tag === 7) {
                      i(
                        ne,
                        Z.sibling
                      ), ge = c(
                        Z,
                        se.props.children
                      ), Vl(ge, se), ge.return = ne, ne = ge;
                      break e;
                    }
                  } else if (Z.elementType === je || typeof je == "object" && je !== null && je.$$typeof === I && js(je) === Z.type) {
                    i(
                      ne,
                      Z.sibling
                    ), ge = c(Z, se.props), Vl(ge, se), ge.return = ne, ne = ge;
                    break e;
                  }
                  i(ne, Z);
                  break;
                } else t(ne, Z);
                Z = Z.sibling;
              }
              se.type === ee ? (ge = Ns(
                se.props.children,
                ne.mode,
                ge,
                se.key
              ), Vl(ge, se), ge.return = ne, ne = ge) : (ge = Fc(
                se.type,
                se.key,
                se.props,
                null,
                ne.mode,
                ge
              ), Vl(ge, se), ge.return = ne, ne = ge);
            }
            return x(ne);
          case de:
            e: {
              for (je = se.key; Z !== null; ) {
                if (Z.key === je)
                  if (Z.tag === 4 && Z.stateNode.containerInfo === se.containerInfo && Z.stateNode.implementation === se.implementation) {
                    i(
                      ne,
                      Z.sibling
                    ), ge = c(Z, se.children || []), ge.return = ne, ne = ge;
                    break e;
                  } else {
                    i(ne, Z);
                    break;
                  }
                else t(ne, Z);
                Z = Z.sibling;
              }
              ge = Sd(se, ne.mode, ge), ge.return = ne, ne = ge;
            }
            return x(ne);
          case I:
            return se = js(se), et(
              ne,
              Z,
              se,
              ge
            );
        }
        if (Ce(se))
          return Ae(
            ne,
            Z,
            se,
            ge
          );
        if (Se(se)) {
          if (je = Se(se), typeof je != "function") throw Error(r(150));
          return se = je.call(se), Oe(
            ne,
            Z,
            se,
            ge
          );
        }
        if (typeof se.then == "function")
          return et(
            ne,
            Z,
            ou(se),
            ge
          );
        if (se.$$typeof === Y)
          return et(
            ne,
            Z,
            au(ne, se),
            ge
          );
        cu(ne, se);
      }
      return typeof se == "string" && se !== "" || typeof se == "number" || typeof se == "bigint" ? (se = "" + se, Z !== null && Z.tag === 6 ? (i(ne, Z.sibling), ge = c(Z, se), ge.return = ne, ne = ge) : (i(ne, Z), ge = bd(se, ne.mode, ge), ge.return = ne, ne = ge), x(ne)) : i(ne, Z);
    }
    return function(ne, Z, se, ge) {
      try {
        ko = 0;
        var je = et(
          ne,
          Z,
          se,
          ge
        );
        return _r = null, je;
      } catch (Le) {
        if (Le === wr || Le === su) throw Le;
        var ut = Mi(29, Le, null, ne.mode);
        return ut.lanes = ge, ut.return = ne, ut;
      }
    };
  }
  var Os = Pg(!0), Jg = Pg(!1), Yl = !1;
  function kd(e) {
    e.updateQueue = {
      baseState: e.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null
    };
  }
  function jd(e, t) {
    e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
      baseState: e.baseState,
      firstBaseUpdate: e.firstBaseUpdate,
      lastBaseUpdate: e.lastBaseUpdate,
      shared: e.shared,
      callbacks: null
    });
  }
  function Il(e) {
    return { lane: e, tag: 0, payload: null, callback: null, next: null };
  }
  function Xl(e, t, i) {
    var l = e.updateQueue;
    if (l === null) return null;
    if (l = l.shared, (wt & 2) !== 0) {
      var c = l.pending;
      return c === null ? t.next = t : (t.next = c.next, c.next = t), l.pending = t, t = Jc(e), Og(e, null, i), t;
    }
    return Pc(e, l, t, i), Jc(e);
  }
  function jo(e, t, i) {
    if (t = t.updateQueue, t !== null && (t = t.shared, (i & 4194048) !== 0)) {
      var l = t.lanes;
      l &= e.pendingLanes, i |= l, t.lanes = i, Ya(e, i);
    }
  }
  function Rd(e, t) {
    var i = e.updateQueue, l = e.alternate;
    if (l !== null && (l = l.updateQueue, i === l)) {
      var c = null, u = null;
      if (i = i.firstBaseUpdate, i !== null) {
        do {
          var x = {
            lane: i.lane,
            tag: i.tag,
            payload: i.payload,
            callback: null,
            next: null
          };
          u === null ? c = u = x : u = u.next = x, i = i.next;
        } while (i !== null);
        u === null ? c = u = t : u = u.next = t;
      } else c = u = t;
      i = {
        baseState: l.baseState,
        firstBaseUpdate: c,
        lastBaseUpdate: u,
        shared: l.shared,
        callbacks: l.callbacks
      }, e.updateQueue = i;
      return;
    }
    e = i.lastBaseUpdate, e === null ? i.firstBaseUpdate = t : e.next = t, i.lastBaseUpdate = t;
  }
  var Od = !1;
  function Ro() {
    if (Od) {
      var e = Sr;
      if (e !== null) throw e;
    }
  }
  function Oo(e, t, i, l) {
    Od = !1;
    var c = e.updateQueue;
    Yl = !1;
    var u = c.firstBaseUpdate, x = c.lastBaseUpdate, T = c.shared.pending;
    if (T !== null) {
      c.shared.pending = null;
      var $ = T, ie = $.next;
      $.next = null, x === null ? u = ie : x.next = ie, x = $;
      var fe = e.alternate;
      fe !== null && (fe = fe.updateQueue, T = fe.lastBaseUpdate, T !== x && (T === null ? fe.firstBaseUpdate = ie : T.next = ie, fe.lastBaseUpdate = $));
    }
    if (u !== null) {
      var ve = c.baseState;
      x = 0, fe = ie = $ = null, T = u;
      do {
        var W = T.lane & -536870913, ue = W !== T.lane;
        if (ue ? (ct & W) === W : (l & W) === W) {
          W !== 0 && W === zs && (Od = !0), fe !== null && (fe = fe.next = {
            lane: 0,
            tag: T.tag,
            payload: T.payload,
            callback: null,
            next: null
          });
          e: {
            var Ae = e, Oe = T;
            W = t;
            var et = i;
            switch (Oe.tag) {
              case 1:
                if (Ae = Oe.payload, typeof Ae == "function") {
                  ve = Ae.call(et, ve, W);
                  break e;
                }
                ve = Ae;
                break e;
              case 3:
                Ae.flags = Ae.flags & -65537 | 128;
              case 0:
                if (Ae = Oe.payload, W = typeof Ae == "function" ? Ae.call(et, ve, W) : Ae, W == null) break e;
                ve = k({}, ve, W);
                break e;
              case 2:
                Yl = !0;
            }
          }
          W = T.callback, W !== null && (e.flags |= 64, ue && (e.flags |= 8192), ue = c.callbacks, ue === null ? c.callbacks = [W] : ue.push(W));
        } else
          ue = {
            lane: W,
            tag: T.tag,
            payload: T.payload,
            callback: T.callback,
            next: null
          }, fe === null ? (ie = fe = ue, $ = ve) : fe = fe.next = ue, x |= W;
        if (T = T.next, T === null) {
          if (T = c.shared.pending, T === null)
            break;
          ue = T, T = ue.next, ue.next = null, c.lastBaseUpdate = ue, c.shared.pending = null;
        }
      } while (!0);
      fe === null && ($ = ve), c.baseState = $, c.firstBaseUpdate = ie, c.lastBaseUpdate = fe, u === null && (c.shared.lanes = 0), Fl |= x, e.lanes = x, e.memoizedState = ve;
    }
  }
  function Fg(e, t) {
    if (typeof e != "function")
      throw Error(r(191, e));
    e.call(t);
  }
  function Wg(e, t) {
    var i = e.callbacks;
    if (i !== null)
      for (e.callbacks = null, e = 0; e < i.length; e++)
        Fg(i[e], t);
  }
  var Gl = Me(null), uu = Me(0);
  function e0(e, t) {
    e = Nl, Re(uu, e), Re(Gl, t), Nl = e | t.baseLanes;
  }
  function Dd() {
    Re(uu, Nl), Re(Gl, Gl.current);
  }
  function Hd() {
    Nl = uu.current, Ge(Gl), Ge(uu);
  }
  var ei = Me(null), mi = null;
  function Zl(e) {
    var t = e.alternate;
    Re(ti, ti.current & 1), Re(ei, e), mi === null && (t === null || Gl.current !== null || t.memoizedState !== null) && (mi = e);
  }
  function Ld(e) {
    Re(ti, ti.current), Re(ei, e), mi === null && (mi = e);
  }
  function t0(e) {
    e.tag === 22 ? (Re(ti, ti.current), Re(ei, e), mi === null && (mi = e)) : Ql();
  }
  function Ql() {
    Re(ti, ti.current), Re(ei, ei.current);
  }
  function Ii(e) {
    Ge(ei), mi === e && (mi = null), Ge(ti);
  }
  var ti = Me(0);
  function Do(e, t) {
    Re(ei, ei.current), Re(ti, t);
  }
  function Ud(e) {
    Ge(ti), Ge(ei), mi === e && (mi = null);
  }
  function fu(e) {
    for (var t = e; t !== null; ) {
      if (t.tag === 13) {
        var i = t.memoizedState;
        if (i !== null && (i = i.dehydrated, i === null || sm(i) || rm(i)))
          return t;
      } else if (t.tag === 19 && t.memoizedProps.revealOrder !== "independent") {
        if ((t.flags & 128) !== 0) return t;
      } else if (t.child !== null) {
        t.child.return = t, t = t.child;
        continue;
      }
      if (t === e) break;
      for (; t.sibling === null; ) {
        if (t.return === null || t.return === e) return null;
        t = t.return;
      }
      t.sibling.return = t.return, t = t.sibling;
    }
    return null;
  }
  var Sl = 0, We = null, Dt = null, En = null, du = !1, Er = !1, Ds = !1, hu = 0, Ho = 0, Nr = null, y_ = 0;
  function cn() {
    throw Error(r(321));
  }
  function Bd(e, t) {
    if (t === null) return !1;
    for (var i = 0; i < t.length && i < e.length; i++)
      if (!Yi(e[i], t[i])) return !1;
    return !0;
  }
  function $d(e, t, i, l, c, u) {
    return Sl = u, We = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, we.H = e === null || e.memoizedState === null ? U0 : B0, Ds = !1, u = i(l, c), Ds = !1, Er && (u = i0(
      t,
      i,
      l,
      c
    )), n0(e), u;
  }
  function n0(e) {
    we.H = bu;
    var t = Dt !== null && Dt.next !== null;
    if (Sl = 0, En = Dt = We = null, du = !1, Ho = 0, Nr = null, t) throw Error(r(300));
    e === null || Nn || (e = e.dependencies, e !== null && iu(e) && (Nn = !0));
  }
  function i0(e, t, i, l) {
    We = e;
    var c = 0;
    do {
      if (Er && (Nr = null), Ho = 0, Er = !1, 25 <= c) throw Error(r(301));
      if (c += 1, En = Dt = null, e.updateQueue != null) {
        var u = e.updateQueue;
        u.lastEffect = null, u.events = null, u.stores = null, u.memoCache != null && (u.memoCache.index = 0);
      }
      we.H = N_, u = t(i, l);
    } while (Er);
    return u;
  }
  function v_() {
    var e = we.H, t = e.useState()[0];
    return t = typeof t.then == "function" ? Lo(t) : t, e = e.useState()[0], (Dt !== null ? Dt.memoizedState : null) !== e && (We.flags |= 1024), t;
  }
  function qd() {
    var e = hu !== 0;
    return hu = 0, e;
  }
  function Vd(e, t, i) {
    t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~i;
  }
  function Yd(e) {
    if (du) {
      for (e = e.memoizedState; e !== null; ) {
        var t = e.queue;
        t !== null && (t.pending = null), e = e.next;
      }
      du = !1;
    }
    Sl = 0, En = Dt = We = null, Er = !1, Ho = hu = 0, Nr = null;
  }
  function vi() {
    var e = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null
    };
    return En === null ? We.memoizedState = En = e : En = En.next = e, En;
  }
  function pn() {
    if (Dt === null) {
      var e = We.alternate;
      e = e !== null ? e.memoizedState : null;
    } else e = Dt.next;
    var t = En === null ? We.memoizedState : En.next;
    if (t !== null)
      En = t, Dt = e;
    else {
      if (e === null)
        throw We.alternate === null ? Error(r(467)) : Error(r(310));
      Dt = e, e = {
        memoizedState: Dt.memoizedState,
        baseState: Dt.baseState,
        baseQueue: Dt.baseQueue,
        queue: Dt.queue,
        next: null
      }, En === null ? We.memoizedState = En = e : En = En.next = e;
    }
    return En;
  }
  function mu() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function Lo(e) {
    var t = Ho;
    return Ho += 1, Nr === null && (Nr = []), e = Zg(Nr, e, t), t = We, (En === null ? t.memoizedState : En.next) === null && (t = t.alternate, we.H = t === null || t.memoizedState === null ? U0 : B0), e;
  }
  function pu(e) {
    if (e !== null && typeof e == "object") {
      if (typeof e.then == "function") return Lo(e);
      if (e.$$typeof === ce) return;
      if (e.$$typeof === Y) return Wn(e);
    }
    throw Error(r(438, String(e)));
  }
  function Id(e) {
    var t = null, i = We.updateQueue;
    if (i !== null && (t = i.memoCache), t == null) {
      var l = We.alternate;
      l !== null && (l = l.updateQueue, l !== null && (l = l.memoCache, l != null && (t = {
        data: l.data.map(function(c) {
          return c.slice();
        }),
        index: 0
      })));
    }
    if (t == null && (t = { data: [], index: 0 }), i === null && (i = mu(), We.updateQueue = i), i.memoCache = t, i = t.data[t.index], i === void 0)
      for (i = t.data[t.index] = Array(e), l = 0; l < e; l++)
        i[l] = Ee;
    return t.index++, i;
  }
  function wl(e, t) {
    return typeof t == "function" ? t(e) : t;
  }
  function gu(e) {
    var t = pn();
    return Xd(t, Dt, e);
  }
  function Xd(e, t, i) {
    var l = e.queue;
    if (l === null) throw Error(r(311));
    l.lastRenderedReducer = i;
    var c = e.baseQueue, u = l.pending;
    if (u !== null) {
      if (c !== null) {
        var x = c.next;
        c.next = u.next, u.next = x;
      }
      t.baseQueue = c = u, l.pending = null;
    }
    if (u = e.baseState, c === null) e.memoizedState = u;
    else {
      t = c.next;
      var T = x = null, $ = null, ie = t, fe = !1;
      do {
        var ve = ie.lane & -536870913;
        if (ve !== ie.lane ? (ct & ve) === ve : (Sl & ve) === ve) {
          var W = ie.revertLane;
          if (W === 0)
            $ !== null && ($ = $.next = {
              lane: 0,
              revertLane: 0,
              gesture: null,
              action: ie.action,
              hasEagerState: ie.hasEagerState,
              eagerState: ie.eagerState,
              next: null
            }), ve === zs && (fe = !0);
          else if ((Sl & W) === W) {
            ie = ie.next, W === zs && (fe = !0);
            continue;
          } else
            ve = {
              lane: 0,
              revertLane: ie.revertLane,
              gesture: null,
              action: ie.action,
              hasEagerState: ie.hasEagerState,
              eagerState: ie.eagerState,
              next: null
            }, $ === null ? (T = $ = ve, x = u) : $ = $.next = ve, We.lanes |= W, Fl |= W;
          ve = ie.action, Ds && i(u, ve), u = ie.hasEagerState ? ie.eagerState : i(u, ve);
        } else
          W = {
            lane: ve,
            revertLane: ie.revertLane,
            gesture: ie.gesture,
            action: ie.action,
            hasEagerState: ie.hasEagerState,
            eagerState: ie.eagerState,
            next: null
          }, $ === null ? (T = $ = W, x = u) : $ = $.next = W, We.lanes |= ve, Fl |= ve;
        ie = ie.next;
      } while (ie !== null && ie !== t);
      if ($ === null ? x = u : $.next = T, !Yi(u, e.memoizedState) && (Nn = !0, fe && (i = Sr, i !== null)))
        throw i;
      e.memoizedState = u, e.baseState = x, e.baseQueue = $, l.lastRenderedState = u;
    }
    return c === null && (l.lanes = 0), [e.memoizedState, l.dispatch];
  }
  function Gd(e) {
    var t = pn(), i = t.queue;
    if (i === null) throw Error(r(311));
    i.lastRenderedReducer = e;
    var l = i.dispatch, c = i.pending, u = t.memoizedState;
    if (c !== null) {
      i.pending = null;
      var x = c = c.next;
      do
        u = e(u, x.action), x = x.next;
      while (x !== c);
      Yi(u, t.memoizedState) || (Nn = !0), t.memoizedState = u, t.baseQueue === null && (t.baseState = u), i.lastRenderedState = u;
    }
    return [u, l];
  }
  function a0(e, t, i) {
    var l = We, c = pn(), u = nt;
    if (u) {
      if (i === void 0) throw Error(r(407));
      i = i();
    } else i = t();
    var x = !Yi(
      (Dt || c).memoizedState,
      i
    );
    if (x && (c.memoizedState = i, Nn = !0), c = c.queue, Kd(r0.bind(null, l, c, e), [
      e
    ]), e = c.getSnapshot !== t || x || En !== null && (En.memoizedState.tag & 1) !== 0, Tr(
      e ? 9 : 8,
      { destroy: void 0 },
      s0.bind(null, l, c, i, t),
      null
    ), e) {
      if (l.flags |= 2048, Ut === null) throw Error(r(349));
      u || (Sl & 127) !== 0 || l0(l, t, i);
    }
    return i;
  }
  function l0(e, t, i) {
    e.flags |= 16384, e = { getSnapshot: t, value: i }, t = We.updateQueue, t === null ? (t = mu(), We.updateQueue = t, t.stores = [e]) : (i = t.stores, i === null ? t.stores = [e] : i.push(e));
  }
  function s0(e, t, i, l) {
    t.value = i, t.getSnapshot = l, o0(t) && c0(e);
  }
  function r0(e, t, i) {
    return i(function() {
      o0(t) && c0(e);
    });
  }
  function o0(e) {
    var t = e.getSnapshot;
    e = e.value;
    try {
      var i = t();
      return !Yi(e, i);
    } catch {
      return !0;
    }
  }
  function c0(e) {
    var t = Es(e, 2);
    t !== null && Ri(t, e, 2);
  }
  function Zd(e) {
    var t = vi();
    if (typeof e == "function") {
      var i = e;
      if (e = i(), Ds) {
        hn(!0);
        try {
          i();
        } finally {
          hn(!1);
        }
      }
    }
    return t.memoizedState = t.baseState = e, t.queue = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: wl,
      lastRenderedState: e
    }, t;
  }
  function u0(e, t, i, l) {
    return e.baseState = i, Xd(
      e,
      Dt,
      typeof l == "function" ? l : wl
    );
  }
  function x_(e, t, i, l, c) {
    if (xu(e)) throw Error(r(485));
    if (e = t.action, e !== null) {
      var u = {
        payload: c,
        action: e,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function(x) {
          u.listeners.push(x);
        }
      };
      we.T !== null ? i(!0) : u.isTransition = !1, l(u), i = t.pending, i === null ? (u.next = t.pending = u, f0(t, u)) : (u.next = i.next, t.pending = i.next = u);
    }
  }
  function f0(e, t) {
    var i = t.action, l = t.payload, c = e.state;
    if (t.isTransition) {
      var u = we.T, x = {};
      x.types = u !== null ? u.types : null, we.T = x;
      try {
        var T = i(c, l), $ = we.S;
        $ !== null && $(x, T), d0(e, t, T);
      } catch (ie) {
        Qd(e, t, ie);
      } finally {
        u !== null && x.types !== null && (u.types = x.types), we.T = u;
      }
    } else
      try {
        u = i(c, l), d0(e, t, u);
      } catch (ie) {
        Qd(e, t, ie);
      }
  }
  function d0(e, t, i) {
    i !== null && typeof i == "object" && typeof i.then == "function" ? i.then(
      function(l) {
        h0(e, t, l);
      },
      function(l) {
        return Qd(e, t, l);
      }
    ) : h0(e, t, i);
  }
  function h0(e, t, i) {
    t.status = "fulfilled", t.value = i, m0(t), e.state = i, t = e.pending, t !== null && (i = t.next, i === t ? e.pending = null : (i = i.next, t.next = i, f0(e, i)));
  }
  function Qd(e, t, i) {
    var l = e.pending;
    if (e.pending = null, l !== null) {
      l = l.next;
      do
        t.status = "rejected", t.reason = i, m0(t), t = t.next;
      while (t !== l);
    }
    e.action = null;
  }
  function m0(e) {
    e = e.listeners;
    for (var t = 0; t < e.length; t++) (0, e[t])();
  }
  function p0(e, t) {
    return t;
  }
  function g0(e, t) {
    if (nt) {
      var i = Ut.formState;
      if (i !== null) {
        e: {
          var l = We;
          if (nt) {
            if (Vt) {
              t: {
                for (var c = Vt, u = fa; c.nodeType !== 8; ) {
                  if (!u) {
                    c = null;
                    break t;
                  }
                  if (c = ha(
                    c.nextSibling
                  ), c === null) {
                    c = null;
                    break t;
                  }
                }
                u = c.data, c = u === "F!" || u === "F" ? c : null;
              }
              if (c) {
                Vt = ha(
                  c.nextSibling
                ), l = c.data === "F!";
                break e;
              }
            }
            $l(l);
          }
          l = !1;
        }
        l && (t = i[0]);
      }
    }
    return i = vi(), i.memoizedState = i.baseState = t, l = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: p0,
      lastRenderedState: t
    }, i.queue = l, i = D0.bind(
      null,
      We,
      l
    ), l.dispatch = i, l = Zd(!1), u = eh.bind(
      null,
      We,
      !1,
      l.queue
    ), l = vi(), c = {
      state: t,
      dispatch: null,
      action: e,
      pending: null
    }, l.queue = c, i = x_.bind(
      null,
      We,
      c,
      u,
      i
    ), c.dispatch = i, l.memoizedState = e, [t, i, !1];
  }
  function y0(e) {
    var t = pn();
    return v0(t, Dt, e);
  }
  function v0(e, t, i) {
    if (t = Xd(
      e,
      t,
      p0
    )[0], e = gu(wl)[0], typeof t == "object" && t !== null && typeof t.then == "function")
      try {
        var l = Lo(t);
      } catch (x) {
        throw x === wr ? su : x;
      }
    else l = t;
    t = pn();
    var c = t.queue, u = c.dispatch;
    return i !== t.memoizedState && (We.flags |= 2048, Tr(
      9,
      { destroy: void 0 },
      b_.bind(null, c, i),
      null
    )), [l, u, e];
  }
  function b_(e, t) {
    e.action = t;
  }
  function x0(e) {
    var t = pn(), i = Dt;
    if (i !== null)
      return v0(t, i, e);
    pn(), t = t.memoizedState, i = pn();
    var l = i.queue.dispatch;
    return i.memoizedState = e, [t, l, !1];
  }
  function Tr(e, t, i, l) {
    return e = { tag: e, create: i, deps: l, inst: t, next: null }, t = We.updateQueue, t === null && (t = mu(), We.updateQueue = t), i = t.lastEffect, i === null ? t.lastEffect = e.next = e : (l = i.next, i.next = e, e.next = l, t.lastEffect = e), e;
  }
  function b0() {
    return pn().memoizedState;
  }
  function yu(e, t, i, l) {
    var c = vi();
    We.flags |= e, c.memoizedState = Tr(
      1 | t,
      { destroy: void 0 },
      i,
      l === void 0 ? null : l
    );
  }
  function vu(e, t, i, l) {
    var c = pn();
    l = l === void 0 ? null : l;
    var u = c.memoizedState.inst;
    Dt !== null && l !== null && Bd(l, Dt.memoizedState.deps) ? c.memoizedState = Tr(t, u, i, l) : (We.flags |= e, c.memoizedState = Tr(
      1 | t,
      u,
      i,
      l
    ));
  }
  function S0(e, t) {
    yu(8390656, 8, e, t);
  }
  function Kd(e, t) {
    vu(2048, 8, e, t);
  }
  function S_(e) {
    We.flags |= 4;
    var t = We.updateQueue;
    if (t === null)
      t = mu(), We.updateQueue = t, t.events = [e];
    else {
      var i = t.events;
      i === null ? t.events = [e] : i.push(e);
    }
  }
  function w0(e) {
    var t = pn().memoizedState;
    return S_({ ref: t, nextImpl: e }), function() {
      if ((wt & 2) !== 0) throw Error(r(440));
      return t.impl.apply(void 0, arguments);
    };
  }
  function _0(e, t) {
    return vu(4, 2, e, t);
  }
  function E0(e, t) {
    return vu(4, 4, e, t);
  }
  function N0(e, t) {
    if (typeof t == "function") {
      e = e();
      var i = t(e);
      return function() {
        typeof i == "function" ? i() : t(null);
      };
    }
    if (t != null)
      return e = e(), t.current = e, function() {
        t.current = null;
      };
  }
  function T0(e, t, i) {
    i = i != null ? i.concat([e]) : null, vu(4, 4, N0.bind(null, t, e), i);
  }
  function Pd() {
  }
  function C0(e, t) {
    var i = pn();
    t = t === void 0 ? null : t;
    var l = i.memoizedState;
    return t !== null && Bd(t, l[1]) ? l[0] : (i.memoizedState = [e, t], e);
  }
  function A0(e, t) {
    var i = pn();
    t = t === void 0 ? null : t;
    var l = i.memoizedState;
    if (t !== null && Bd(t, l[1]))
      return l[0];
    if (l = e(), Ds) {
      hn(!0);
      try {
        e();
      } finally {
        hn(!1);
      }
    }
    return i.memoizedState = [l, t], l;
  }
  function Jd(e, t, i) {
    return i === void 0 || (Sl & 1073741824) !== 0 && (ct & 261930) === 0 ? e.memoizedState = t : (e.memoizedState = i, e = Uy(), We.lanes |= e, Fl |= e, i);
  }
  function M0(e, t, i, l) {
    return Yi(i, t) ? i : Gl.current !== null ? (e = Jd(e, i, l), Yi(e, t) || (Nn = !0), e) : (Sl & 106) === 0 || (Sl & 1073741824) !== 0 && (ct & 261930) === 0 ? (Nn = !0, e.memoizedState = i) : (e = Uy(), We.lanes |= e, Fl |= e, t);
  }
  function z0(e, t, i, l, c) {
    var u = Ne.p;
    Ne.p = u !== 0 && 8 > u ? u : 8;
    var x = we.T, T = {};
    T.types = x !== null ? x.types : null, we.T = T, eh(e, !1, t, i);
    try {
      var $ = c(), ie = we.S;
      if (ie !== null && ie(T, $), $ !== null && typeof $ == "object" && typeof $.then == "function") {
        var fe = g_(
          $,
          l
        );
        Uo(
          e,
          t,
          fe,
          Qi(e)
        );
      } else
        Uo(
          e,
          t,
          l,
          Qi(e)
        );
    } catch (ve) {
      Uo(
        e,
        t,
        { then: function() {
        }, status: "rejected", reason: ve },
        Qi()
      );
    } finally {
      Ne.p = u, x !== null && T.types !== null && (x.types = T.types), we.T = x;
    }
  }
  function w_() {
  }
  function Fd(e, t, i, l) {
    if (e.tag !== 5) throw Error(r(476));
    var c = k0(e).queue;
    z0(
      e,
      c,
      t,
      ze,
      i === null ? w_ : function() {
        return j0(e), i(l);
      }
    );
  }
  function k0(e) {
    var t = e.memoizedState;
    if (t !== null) return t;
    t = {
      memoizedState: ze,
      baseState: ze,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: wl,
        lastRenderedState: ze
      },
      next: null
    };
    var i = {};
    return t.next = {
      memoizedState: i,
      baseState: i,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: wl,
        lastRenderedState: i
      },
      next: null
    }, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
  }
  function j0(e) {
    var t = k0(e);
    t.next === null && (t = e.alternate.memoizedState), Uo(
      e,
      t.next.queue,
      {},
      Qi()
    );
  }
  function Wd() {
    return Wn(Xr);
  }
  function R0() {
    return pn().memoizedState;
  }
  function O0() {
    return pn().memoizedState;
  }
  function __(e) {
    for (var t = e.return; t !== null; ) {
      switch (t.tag) {
        case 24:
        case 3:
          var i = Qi();
          e = Il(i);
          var l = Xl(t, e, i);
          l !== null && (Ri(l, t, i), jo(l, t, i)), t = { cache: Cd() }, e.payload = t;
          return;
      }
      t = t.return;
    }
  }
  function E_(e, t, i) {
    var l = Qi();
    i = {
      lane: l,
      revertLane: 0,
      gesture: null,
      action: i,
      hasEagerState: !1,
      eagerState: null,
      next: null
    }, xu(e) ? H0(t, i) : (i = vd(e, t, i, l), i !== null && (Ri(i, e, l), L0(i, t, l)));
  }
  function D0(e, t, i) {
    var l = Qi();
    Uo(e, t, i, l);
  }
  function Uo(e, t, i, l) {
    var c = {
      lane: l,
      revertLane: 0,
      gesture: null,
      action: i,
      hasEagerState: !1,
      eagerState: null,
      next: null
    };
    if (xu(e)) H0(t, c);
    else {
      var u = e.alternate;
      if (e.lanes === 0 && (u === null || u.lanes === 0) && (u = t.lastRenderedReducer, u !== null))
        try {
          var x = t.lastRenderedState, T = u(x, i);
          if (c.hasEagerState = !0, c.eagerState = T, Yi(T, x))
            return Pc(e, t, c, 0), Ut === null && Kc(), !1;
        } catch {
        }
      if (i = vd(e, t, c, l), i !== null)
        return Ri(i, e, l), L0(i, t, l), !0;
    }
    return !1;
  }
  function eh(e, t, i, l) {
    if (l = {
      lane: 2,
      revertLane: Ih(),
      gesture: null,
      action: l,
      hasEagerState: !1,
      eagerState: null,
      next: null
    }, xu(e)) {
      if (t) throw Error(r(479));
    } else
      t = vd(
        e,
        i,
        l,
        2
      ), t !== null && Ri(t, e, 2);
  }
  function xu(e) {
    var t = e.alternate;
    return e === We || t !== null && t === We;
  }
  function H0(e, t) {
    Er = du = !0;
    var i = e.pending;
    i === null ? t.next = t : (t.next = i.next, i.next = t), e.pending = t;
  }
  function L0(e, t, i) {
    if ((i & 4194048) !== 0) {
      var l = t.lanes;
      l &= e.pendingLanes, i |= l, t.lanes = i, Ya(e, i);
    }
  }
  var bu = {
    readContext: Wn,
    use: pu,
    useCallback: cn,
    useContext: cn,
    useEffect: cn,
    useImperativeHandle: cn,
    useLayoutEffect: cn,
    useInsertionEffect: cn,
    useMemo: cn,
    useReducer: cn,
    useRef: cn,
    useState: cn,
    useDebugValue: cn,
    useDeferredValue: cn,
    useTransition: cn,
    useSyncExternalStore: cn,
    useId: cn,
    useHostTransitionStatus: cn,
    useFormState: cn,
    useActionState: cn,
    useOptimistic: cn,
    useMemoCache: cn,
    useCacheRefresh: cn,
    useEffectEvent: cn
  }, U0 = {
    readContext: Wn,
    use: pu,
    useCallback: function(e, t) {
      return vi().memoizedState = [
        e,
        t === void 0 ? null : t
      ], e;
    },
    useContext: Wn,
    useEffect: S0,
    useImperativeHandle: function(e, t, i) {
      i = i != null ? i.concat([e]) : null, yu(
        4194308,
        4,
        N0.bind(null, t, e),
        i
      );
    },
    useLayoutEffect: function(e, t) {
      return yu(4194308, 4, e, t);
    },
    useInsertionEffect: function(e, t) {
      yu(4, 2, e, t);
    },
    useMemo: function(e, t) {
      var i = vi();
      t = t === void 0 ? null : t;
      var l = e();
      if (Ds) {
        hn(!0);
        try {
          e();
        } finally {
          hn(!1);
        }
      }
      return i.memoizedState = [l, t], l;
    },
    useReducer: function(e, t, i) {
      var l = vi();
      if (i !== void 0) {
        var c = i(t);
        if (Ds) {
          hn(!0);
          try {
            i(t);
          } finally {
            hn(!1);
          }
        }
      } else c = t;
      return l.memoizedState = l.baseState = c, e = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: e,
        lastRenderedState: c
      }, l.queue = e, e = e.dispatch = E_.bind(
        null,
        We,
        e
      ), [l.memoizedState, e];
    },
    useRef: function(e) {
      var t = vi();
      return e = { current: e }, t.memoizedState = e;
    },
    useState: function(e) {
      e = Zd(e);
      var t = e.queue, i = D0.bind(null, We, t);
      return t.dispatch = i, [e.memoizedState, i];
    },
    useDebugValue: Pd,
    useDeferredValue: function(e, t) {
      var i = vi();
      return Jd(i, e, t);
    },
    useTransition: function() {
      var e = Zd(!1);
      return e = z0.bind(
        null,
        We,
        e.queue,
        !0,
        !1
      ), vi().memoizedState = e, [!1, e];
    },
    useSyncExternalStore: function(e, t, i) {
      var l = We, c = vi();
      if (nt) {
        if (i === void 0)
          throw Error(r(407));
        i = i();
      } else {
        if (i = t(), Ut === null)
          throw Error(r(349));
        (ct & 127) !== 0 || l0(l, t, i);
      }
      c.memoizedState = i;
      var u = { value: i, getSnapshot: t };
      return c.queue = u, S0(r0.bind(null, l, u, e), [
        e
      ]), l.flags |= 2048, Tr(
        9,
        { destroy: void 0 },
        s0.bind(
          null,
          l,
          u,
          i,
          t
        ),
        null
      ), i;
    },
    useId: function() {
      var e = vi(), t = Ut.identifierPrefix;
      if (nt) {
        var i = Ka, l = Qa;
        i = (l & ~(1 << 32 - Mt(l) - 1)).toString(32) + i, t = "_" + t + "R_" + i, i = hu++, 0 < i && (t += "H" + i.toString(32)), t += "_";
      } else
        i = y_++, t = "_" + t + "r_" + i.toString(32) + "_";
      return e.memoizedState = t;
    },
    useHostTransitionStatus: Wd,
    useFormState: g0,
    useActionState: g0,
    useOptimistic: function(e) {
      var t = vi();
      t.memoizedState = t.baseState = e;
      var i = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: null,
        lastRenderedState: null
      };
      return t.queue = i, t = eh.bind(
        null,
        We,
        !0,
        i
      ), i.dispatch = t, [e, t];
    },
    useMemoCache: Id,
    useCacheRefresh: function() {
      return vi().memoizedState = __.bind(
        null,
        We
      );
    },
    useEffectEvent: function(e) {
      var t = vi(), i = { impl: e };
      return t.memoizedState = i, function() {
        if ((wt & 2) !== 0)
          throw Error(r(440));
        return i.impl.apply(void 0, arguments);
      };
    }
  }, B0 = {
    readContext: Wn,
    use: pu,
    useCallback: C0,
    useContext: Wn,
    useEffect: Kd,
    useImperativeHandle: T0,
    useInsertionEffect: _0,
    useLayoutEffect: E0,
    useMemo: A0,
    useReducer: gu,
    useRef: b0,
    useState: function() {
      return gu(wl);
    },
    useDebugValue: Pd,
    useDeferredValue: function(e, t) {
      var i = pn();
      return M0(
        i,
        Dt.memoizedState,
        e,
        t
      );
    },
    useTransition: function() {
      var e = gu(wl)[0], t = pn().memoizedState;
      return [
        typeof e == "boolean" ? e : Lo(e),
        t
      ];
    },
    useSyncExternalStore: a0,
    useId: R0,
    useHostTransitionStatus: Wd,
    useFormState: y0,
    useActionState: y0,
    useOptimistic: function(e, t) {
      var i = pn();
      return u0(i, Dt, e, t);
    },
    useMemoCache: Id,
    useCacheRefresh: O0,
    useEffectEvent: w0
  }, N_ = {
    readContext: Wn,
    use: pu,
    useCallback: C0,
    useContext: Wn,
    useEffect: Kd,
    useImperativeHandle: T0,
    useInsertionEffect: _0,
    useLayoutEffect: E0,
    useMemo: A0,
    useReducer: Gd,
    useRef: b0,
    useState: function() {
      return Gd(wl);
    },
    useDebugValue: Pd,
    useDeferredValue: function(e, t) {
      var i = pn();
      return Dt === null ? Jd(i, e, t) : M0(
        i,
        Dt.memoizedState,
        e,
        t
      );
    },
    useTransition: function() {
      var e = Gd(wl)[0], t = pn().memoizedState;
      return [
        typeof e == "boolean" ? e : Lo(e),
        t
      ];
    },
    useSyncExternalStore: a0,
    useId: R0,
    useHostTransitionStatus: Wd,
    useFormState: x0,
    useActionState: x0,
    useOptimistic: function(e, t) {
      var i = pn();
      return Dt !== null ? u0(i, Dt, e, t) : (i.baseState = e, [e, i.queue.dispatch]);
    },
    useMemoCache: Id,
    useCacheRefresh: O0,
    useEffectEvent: w0
  };
  function th(e, t, i, l) {
    t = e.memoizedState, i = i(l, t), i = i == null ? t : k({}, t, i), e.memoizedState = i, e.lanes === 0 && (e.updateQueue.baseState = i);
  }
  var nh = {
    enqueueSetState: function(e, t, i) {
      e = e._reactInternals;
      var l = Qi(), c = Il(l);
      c.payload = t, i != null && (c.callback = i), t = Xl(e, c, l), t !== null && (Ri(t, e, l), jo(t, e, l));
    },
    enqueueReplaceState: function(e, t, i) {
      e = e._reactInternals;
      var l = Qi(), c = Il(l);
      c.tag = 1, c.payload = t, i != null && (c.callback = i), t = Xl(e, c, l), t !== null && (Ri(t, e, l), jo(t, e, l));
    },
    enqueueForceUpdate: function(e, t) {
      e = e._reactInternals;
      var i = Qi(), l = Il(i);
      l.tag = 2, t != null && (l.callback = t), t = Xl(e, l, i), t !== null && (Ri(t, e, i), jo(t, e, i));
    }
  };
  function $0(e, t, i, l, c, u, x) {
    return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(l, u, x) : t.prototype && t.prototype.isPureReactComponent ? !Eo(i, l) || !Eo(c, u) : !0;
  }
  function q0(e, t, i, l) {
    e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(i, l), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(i, l), t.state !== e && nh.enqueueReplaceState(t, t.state, null);
  }
  function Hs(e, t) {
    var i = t;
    if ("ref" in t) {
      i = {};
      for (var l in t)
        l !== "ref" && (i[l] = t[l]);
    }
    if (e = e.defaultProps) {
      i === t && (i = k({}, i));
      for (var c in e)
        i[c] === void 0 && (i[c] = e[c]);
    }
    return i;
  }
  function V0(e) {
    Qc(e);
  }
  function Y0(e) {
    console.error(e);
  }
  function I0(e) {
    Qc(e);
  }
  function Su(e, t) {
    try {
      var i = e.onUncaughtError;
      i(t.value, { componentStack: t.stack });
    } catch (l) {
      setTimeout(function() {
        throw l;
      });
    }
  }
  function X0(e, t, i) {
    try {
      var l = e.onCaughtError;
      l(i.value, {
        componentStack: i.stack,
        errorBoundary: t.tag === 1 ? t.stateNode : null
      });
    } catch (c) {
      setTimeout(function() {
        throw c;
      });
    }
  }
  function ih(e, t, i) {
    return i = Il(i), i.tag = 3, i.payload = { element: null }, i.callback = function() {
      Su(e, t);
    }, i;
  }
  function G0(e) {
    return e = Il(e), e.tag = 3, e;
  }
  function Z0(e, t, i, l) {
    var c = i.type.getDerivedStateFromError;
    if (typeof c == "function") {
      var u = l.value;
      e.payload = function() {
        return c(u);
      }, e.callback = function() {
        X0(t, i, l);
      };
    }
    var x = i.stateNode;
    x !== null && typeof x.componentDidCatch == "function" && (e.callback = function() {
      X0(t, i, l), typeof c != "function" && (Wl === null ? Wl = /* @__PURE__ */ new Set([this]) : Wl.add(this));
      var T = l.stack;
      this.componentDidCatch(l.value, {
        componentStack: T !== null ? T : ""
      });
    });
  }
  function T_(e, t, i, l, c) {
    if (i.flags |= 32768, l !== null && typeof l == "object" && typeof l.then == "function") {
      if (t = i.alternate, t !== null && As(
        t,
        i,
        c,
        !0
      ), i = ei.current, i !== null) {
        switch (i.tag) {
          case 31:
          case 13:
          case 19:
            return mi === null ? Vu() : i.alternate === null && un === 0 && (un = 3), i.flags &= -257, i.flags |= 65536, i.lanes = c, l === ru ? i.flags |= 16384 : (t = i.updateQueue, t === null ? i.updateQueue = /* @__PURE__ */ new Set([l]) : t.add(l), qh(e, l, c)), !1;
          case 22:
            return i.flags |= 65536, l === ru ? i.flags |= 16384 : (t = i.updateQueue, t === null ? (t = {
              transitions: null,
              markerInstances: null,
              retryQueue: /* @__PURE__ */ new Set([l])
            }, i.updateQueue = t) : (i = t.retryQueue, i === null ? t.retryQueue = /* @__PURE__ */ new Set([l]) : i.add(l)), qh(e, l, c)), !1;
        }
        throw Error(r(435, i.tag));
      }
      return qh(e, l, c), Vu(), !1;
    }
    if (nt)
      return t = ei.current, t !== null ? ((t.flags & 65536) === 0 && (t.flags |= 256), t.flags |= 65536, t.lanes = c, l !== _d && (e = Error(r(422), { cause: l }), Co(oa(e, i)))) : (l !== _d && (t = Error(r(423), {
        cause: l
      }), Co(
        oa(t, i)
      )), e = e.current.alternate, e.flags |= 65536, c &= -c, e.lanes |= c, l = oa(l, i), c = ih(
        e.stateNode,
        l,
        c
      ), Rd(e, c), un !== 4 && (un = 2)), !1;
    var u = Error(r(520), { cause: l });
    if (u = oa(u, i), Go === null ? Go = [u] : Go.push(u), un !== 4 && (un = 2), t === null) return !0;
    l = oa(l, i), i = t;
    do {
      switch (i.tag) {
        case 3:
          return i.flags |= 65536, e = c & -c, i.lanes |= e, e = ih(i.stateNode, l, e), Rd(i, e), !1;
        case 1:
          if (t = i.type, u = i.stateNode, (i.flags & 128) === 0 && (typeof t.getDerivedStateFromError == "function" || u !== null && typeof u.componentDidCatch == "function" && (Wl === null || !Wl.has(u))))
            return i.flags |= 65536, c &= -c, i.lanes |= c, c = G0(c), Z0(
              c,
              e,
              i,
              l
            ), Rd(i, c), !1;
          break;
        case 22:
          if (i.memoizedState !== null)
            return i.flags |= 65536, !1;
      }
      i = i.return;
    } while (i !== null);
    return !1;
  }
  var ah = Error(r(461)), Nn = !1;
  function Dn(e, t, i, l) {
    t.child = e === null ? Jg(t, null, i, l) : Os(
      t,
      e.child,
      i,
      l
    );
  }
  function Q0(e, t, i, l, c) {
    i = i.render;
    var u = t.ref;
    if ("ref" in l) {
      var x = {};
      for (var T in l)
        T !== "ref" && (x[T] = l[T]);
    } else x = l;
    return Ms(t), l = $d(
      e,
      t,
      i,
      x,
      u,
      c
    ), T = qd(), e !== null && !Nn ? (Vd(e, t, c), _l(e, t, c)) : (nt && T && eu(t), t.flags |= 1, Dn(e, t, l, c), t.child);
  }
  function K0(e, t, i, l, c) {
    if (e === null) {
      var u = i.type;
      return typeof u == "function" && !xd(u) && u.defaultProps === void 0 && i.compare === null ? (t.tag = 15, t.type = u, P0(
        e,
        t,
        u,
        l,
        c
      )) : (e = Fc(
        i.type,
        null,
        l,
        t,
        t.mode,
        c
      ), e.ref = t.ref, e.return = t, t.child = e);
    }
    if (u = e.child, !dh(e, c)) {
      var x = u.memoizedProps;
      if (i = i.compare, i = i !== null ? i : Eo, i(x, l) && e.ref === t.ref)
        return _l(e, t, c);
    }
    return t.flags |= 1, e = yl(u, l), e.ref = t.ref, e.return = t, t.child = e;
  }
  function P0(e, t, i, l, c) {
    if (e !== null) {
      var u = e.memoizedProps;
      if (Eo(u, l) && e.ref === t.ref)
        if (Nn = !1, t.pendingProps = l = u, dh(e, c))
          (e.flags & 131072) !== 0 && (Nn = !0);
        else
          return t.lanes = e.lanes, _l(e, t, c);
    }
    return lh(
      e,
      t,
      i,
      l,
      c
    );
  }
  function J0(e, t, i, l) {
    var c = l.children, u = e !== null ? e.memoizedState : null;
    if (e === null && t.stateNode === null && (t.stateNode = {
      _visibility: 1,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null
    }), l.mode === "hidden") {
      if ((t.flags & 128) !== 0) {
        if (u = u !== null ? u.baseLanes | i : i, e !== null) {
          for (l = t.child = e.child, c = 0; l !== null; )
            c = c | l.lanes | l.childLanes, l = l.sibling;
          l = c & ~u;
        } else l = 0, t.child = null;
        return F0(
          e,
          t,
          u,
          i,
          l
        );
      }
      if ((i & 536870912) !== 0)
        t.memoizedState = { baseLanes: 0, cachePool: null }, e !== null && lu(
          t,
          u !== null ? u.cachePool : null
        ), u !== null ? e0(t, u) : Dd(), t0(t);
      else
        return l = t.lanes = 536870912, F0(
          e,
          t,
          u !== null ? u.baseLanes | i : i,
          i,
          l
        );
    } else
      u !== null ? (lu(t, u.cachePool), e0(t, u), Ql(), t.memoizedState = null) : (e !== null && lu(t, null), Dd(), Ql());
    return Dn(e, t, c, i), t.child;
  }
  function Bo(e, t) {
    return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
      _visibility: 1,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null
    }), t.sibling;
  }
  function F0(e, t, i, l, c) {
    var u = Md();
    return u = u === null ? null : { parent: _n._currentValue, pool: u }, t.memoizedState = {
      baseLanes: i,
      cachePool: u
    }, e !== null && lu(t, null), Dd(), t0(t), e !== null && As(e, t, l, !0), t.childLanes = c, null;
  }
  function wu(e, t) {
    return t = _u(
      { mode: t.mode, children: t.children },
      e.mode
    ), t.ref = e.ref, e.child = t, t.return = e, t;
  }
  function W0(e, t, i) {
    return Os(t, e.child, null, i), e = wu(t, t.pendingProps), e.flags |= 2, Ii(t), t.memoizedState = null, e;
  }
  function C_(e, t, i) {
    var l = t.pendingProps, c = (t.flags & 128) !== 0;
    if (t.flags &= -129, e === null) {
      if (nt) {
        if (l.mode === "hidden")
          return e = wu(t, l), t.lanes = 536870912, e.memoizedState = { baseLanes: 0, cachePool: null }, Bo(null, e);
        if (Ld(t), (e = Vt) ? (e = Nv(
          e,
          fa
        ), e = e !== null && e.data === "&" ? e : null, e !== null && (t.memoizedState = {
          dehydrated: e,
          treeContext: Ul !== null ? { id: Qa, overflow: Ka } : null,
          retryLane: 536870912,
          hydrationErrors: null
        }, i = Hg(e), i.return = t, t.child = i, Yn = t, Vt = null)) : e = null, e === null) throw $l(t);
        return t.lanes = 536870912, null;
      }
      return wu(t, l);
    }
    var u = e.memoizedState;
    if (u !== null) {
      var x = u.dehydrated;
      if (Ld(t), c)
        if (t.flags & 256)
          t.flags &= -257, t = W0(
            e,
            t,
            i
          );
        else if (t.memoizedState !== null)
          t.child = e.child, t.flags |= 128, t = null;
        else throw Error(r(558));
      else if (Nn || As(e, t, i, !1), c = (i & e.childLanes) !== 0, Nn || c) {
        if (Gl.current === null) {
          if (l = Ut, l !== null && (x = rt(l, i), x !== 0 && x !== u.retryLane))
            throw u.retryLane = x, Es(e, x), Ri(l, e, x), ah;
          Vu();
        }
        t = W0(
          e,
          t,
          i
        );
      } else
        e = u.treeContext, Vt = ha(x.nextSibling), Yn = t, nt = !0, Bl = null, fa = !1, e !== null && Bg(t, e), t = wu(t, l), t.flags |= 134221824;
      return t;
    }
    return e = yl(e.child, {
      mode: l.mode,
      children: l.children
    }), e.ref = t.ref, t.child = e, e.return = t, e;
  }
  function Cr(e, t) {
    var i = t.ref;
    if (i === null)
      e !== null && e.ref !== null && (t.flags |= 4194816);
    else {
      if (typeof i != "function" && typeof i != "object")
        throw Error(r(284));
      (e === null || e.ref !== i) && (t.flags |= 4194816);
    }
  }
  function lh(e, t, i, l, c) {
    return Ms(t), i = $d(
      e,
      t,
      i,
      l,
      void 0,
      c
    ), l = qd(), e !== null && !Nn ? (Vd(e, t, c), _l(e, t, c)) : (nt && l && eu(t), t.flags |= 1, Dn(e, t, i, c), t.child);
  }
  function ey(e, t, i, l, c, u) {
    return Ms(t), t.updateQueue = null, i = i0(
      t,
      l,
      i,
      c
    ), n0(e), l = qd(), e !== null && !Nn ? (Vd(e, t, u), _l(e, t, u)) : (nt && l && eu(t), t.flags |= 1, Dn(e, t, i, u), t.child);
  }
  function ty(e, t, i, l, c) {
    if (Ms(t), t.stateNode === null) {
      var u = yr, x = i.contextType;
      typeof x == "object" && x !== null && (u = Wn(x)), u = new i(l, u), t.memoizedState = u.state !== null && u.state !== void 0 ? u.state : null, u.updater = nh, t.stateNode = u, u._reactInternals = t, u = t.stateNode, u.props = l, u.state = t.memoizedState, u.refs = {}, kd(t), x = i.contextType, u.context = typeof x == "object" && x !== null ? Wn(x) : yr, u.state = t.memoizedState, x = i.getDerivedStateFromProps, typeof x == "function" && (th(
        t,
        i,
        x,
        l
      ), u.state = t.memoizedState), typeof i.getDerivedStateFromProps == "function" || typeof u.getSnapshotBeforeUpdate == "function" || typeof u.UNSAFE_componentWillMount != "function" && typeof u.componentWillMount != "function" || (x = u.state, typeof u.componentWillMount == "function" && u.componentWillMount(), typeof u.UNSAFE_componentWillMount == "function" && u.UNSAFE_componentWillMount(), x !== u.state && nh.enqueueReplaceState(u, u.state, null), Oo(t, l, u, c), Ro(), u.state = t.memoizedState), typeof u.componentDidMount == "function" && (t.flags |= 4194308), l = !0;
    } else if (e === null) {
      u = t.stateNode;
      var T = t.memoizedProps, $ = Hs(i, T);
      u.props = $;
      var ie = u.context, fe = i.contextType;
      x = yr, typeof fe == "object" && fe !== null && (x = Wn(fe));
      var ve = i.getDerivedStateFromProps;
      fe = typeof ve == "function" || typeof u.getSnapshotBeforeUpdate == "function", T = t.pendingProps !== T, fe || typeof u.UNSAFE_componentWillReceiveProps != "function" && typeof u.componentWillReceiveProps != "function" || (T || ie !== x) && q0(
        t,
        u,
        l,
        x
      ), Yl = !1;
      var W = t.memoizedState;
      u.state = W, Oo(t, l, u, c), Ro(), ie = t.memoizedState, T || W !== ie || Yl ? (typeof ve == "function" && (th(
        t,
        i,
        ve,
        l
      ), ie = t.memoizedState), ($ = Yl || $0(
        t,
        i,
        $,
        l,
        W,
        ie,
        x
      )) ? (fe || typeof u.UNSAFE_componentWillMount != "function" && typeof u.componentWillMount != "function" || (typeof u.componentWillMount == "function" && u.componentWillMount(), typeof u.UNSAFE_componentWillMount == "function" && u.UNSAFE_componentWillMount()), typeof u.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof u.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = l, t.memoizedState = ie), u.props = l, u.state = ie, u.context = x, l = $) : (typeof u.componentDidMount == "function" && (t.flags |= 4194308), l = !1);
    } else {
      u = t.stateNode, jd(e, t), x = t.memoizedProps, fe = Hs(i, x), u.props = fe, ve = t.pendingProps, W = u.context, ie = i.contextType, $ = yr, typeof ie == "object" && ie !== null && ($ = Wn(ie)), T = i.getDerivedStateFromProps, (ie = typeof T == "function" || typeof u.getSnapshotBeforeUpdate == "function") || typeof u.UNSAFE_componentWillReceiveProps != "function" && typeof u.componentWillReceiveProps != "function" || (x !== ve || W !== $) && q0(
        t,
        u,
        l,
        $
      ), Yl = !1, W = t.memoizedState, u.state = W, Oo(t, l, u, c), Ro();
      var ue = t.memoizedState;
      x !== ve || W !== ue || Yl || e !== null && e.dependencies !== null && iu(e.dependencies) ? (typeof T == "function" && (th(
        t,
        i,
        T,
        l
      ), ue = t.memoizedState), (fe = Yl || $0(
        t,
        i,
        fe,
        l,
        W,
        ue,
        $
      ) || e !== null && e.dependencies !== null && iu(e.dependencies)) ? (ie || typeof u.UNSAFE_componentWillUpdate != "function" && typeof u.componentWillUpdate != "function" || (typeof u.componentWillUpdate == "function" && u.componentWillUpdate(l, ue, $), typeof u.UNSAFE_componentWillUpdate == "function" && u.UNSAFE_componentWillUpdate(
        l,
        ue,
        $
      )), typeof u.componentDidUpdate == "function" && (t.flags |= 4), typeof u.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof u.componentDidUpdate != "function" || x === e.memoizedProps && W === e.memoizedState || (t.flags |= 4), typeof u.getSnapshotBeforeUpdate != "function" || x === e.memoizedProps && W === e.memoizedState || (t.flags |= 1024), t.memoizedProps = l, t.memoizedState = ue), u.props = l, u.state = ue, u.context = $, l = fe) : (typeof u.componentDidUpdate != "function" || x === e.memoizedProps && W === e.memoizedState || (t.flags |= 4), typeof u.getSnapshotBeforeUpdate != "function" || x === e.memoizedProps && W === e.memoizedState || (t.flags |= 1024), l = !1);
    }
    return u = l, Cr(e, t), l = (t.flags & 128) !== 0, u || l ? (u = t.stateNode, i = l && typeof i.getDerivedStateFromError != "function" ? null : u.render(), t.flags |= 1, e !== null && l ? (t.child = Os(
      t,
      e.child,
      null,
      c
    ), t.child = Os(
      t,
      null,
      i,
      c
    )) : Dn(e, t, i, c), t.memoizedState = u.state, e = t.child) : e = _l(
      e,
      t,
      c
    ), e;
  }
  function ny(e, t, i, l) {
    return Ts(), t.flags |= 256, Dn(e, t, i, l), t.child;
  }
  var sh = {
    dehydrated: null,
    treeContext: null,
    retryLane: 0,
    hydrationErrors: null
  };
  function rh(e) {
    return { baseLanes: e, cachePool: Xg() };
  }
  function oh(e, t, i) {
    return e = e !== null ? e.childLanes & ~i : 0, t && (e |= Zi), e;
  }
  function iy(e, t, i) {
    var l = t.pendingProps, c = !1, u = (t.flags & 128) !== 0, x;
    if ((x = u) || (x = e !== null && e.memoizedState === null ? !1 : (ti.current & 2) !== 0), x && (c = !0, t.flags &= -129), x = (t.flags & 32) !== 0, t.flags &= -33, e === null) {
      if (nt) {
        if (c ? Zl(t) : Ql(), (e = Vt) ? (e = Nv(
          e,
          fa
        ), e = e !== null && e.data !== "&" ? e : null, e !== null && (t.memoizedState = {
          dehydrated: e,
          treeContext: Ul !== null ? { id: Qa, overflow: Ka } : null,
          retryLane: 536870912,
          hydrationErrors: null
        }, i = Hg(e), i.return = t, t.child = i, Yn = t, Vt = null)) : e = null, e === null) throw $l(t);
        return rm(e) ? t.lanes = 32 : t.lanes = 536870912, null;
      }
      return u = l.children, l = l.fallback, c ? (Ql(), c = t.mode, u = _u(
        { mode: "hidden", children: u },
        c
      ), l = Ns(
        l,
        c,
        i,
        null
      ), u.return = t, l.return = t, u.sibling = l, t.child = u, l = t.child, l.memoizedState = rh(i), l.childLanes = oh(
        e,
        x,
        i
      ), t.memoizedState = sh, Bo(null, l)) : (Zl(t), ch(t, u));
    }
    var T = e.memoizedState;
    if (T !== null) {
      var $ = T.dehydrated;
      if ($ !== null)
        return A_(
          e,
          t,
          u,
          x,
          l,
          $,
          T,
          i
        );
    }
    return c ? (Ql(), c = l.fallback, u = t.mode, T = e.child, $ = T.sibling, l = yl(T, {
      mode: "hidden",
      children: l.children
    }), l.subtreeFlags = T.subtreeFlags & 1206910976, $ !== null ? c = yl($, c) : (c = Ns(
      c,
      u,
      i,
      null
    ), c.flags |= 2), c.return = t, l.return = t, l.sibling = c, t.child = l, Bo(null, l), l = t.child, c = e.child.memoizedState, c === null ? c = rh(i) : (u = c.cachePool, u !== null ? (T = _n._currentValue, u = u.parent !== T ? { parent: T, pool: T } : u) : u = Xg(), c = {
      baseLanes: c.baseLanes | i,
      cachePool: u
    }), l.memoizedState = c, l.childLanes = oh(
      e,
      x,
      i
    ), t.memoizedState = sh, Bo(e.child, l)) : (Zl(t), i = e.child, e = i.sibling, i = yl(i, {
      mode: "visible",
      children: l.children
    }), i.return = t, i.sibling = null, e !== null && (x = t.deletions, x === null ? (t.deletions = [e], t.flags |= 16) : x.push(e)), t.child = i, t.memoizedState = null, i);
  }
  function ch(e, t) {
    return t = _u(
      { mode: "visible", children: t },
      e.mode
    ), t.return = e, e.child = t;
  }
  function _u(e, t) {
    return e = Mi(22, e, null, t), e.lanes = 0, e;
  }
  function Eu(e, t, i) {
    return Os(t, e.child, null, i), e = ch(
      t,
      t.pendingProps.children
    ), e.flags |= 2, t.memoizedState = null, e;
  }
  function A_(e, t, i, l, c, u, x, T) {
    if (i)
      return t.flags & 256 ? (Zl(t), t.flags &= -257, Eu(
        e,
        t,
        T
      )) : t.memoizedState !== null ? (Ql(), t.child = e.child, t.flags |= 128, null) : (Ql(), u = c.fallback, x = t.mode, c = _u(
        { mode: "visible", children: c.children },
        x
      ), u = Ns(
        u,
        x,
        T,
        null
      ), u.flags |= 2, c.return = t, u.return = t, c.sibling = u, t.child = c, Os(t, e.child, null, T), c = t.child, c.memoizedState = rh(T), c.childLanes = oh(
        e,
        l,
        T
      ), t.memoizedState = sh, Bo(null, c));
    if (Zl(t), rm(u)) {
      if (l = u.nextSibling && u.nextSibling.dataset, l) var $ = l.dgst;
      return l = $, l !== "" && (c = Error(r(419)), c.stack = "", c.digest = l, Co({ value: c, source: null, stack: null })), Eu(
        e,
        t,
        T
      );
    }
    if (Nn || As(e, t, T, !1), l = (T & e.childLanes) !== 0, Nn || l) {
      if (Gl.current !== null)
        return Eu(
          e,
          t,
          T
        );
      if (l = Ut, l !== null && (c = rt(
        l,
        T
      ), c !== 0 && c !== x.retryLane))
        throw x.retryLane = c, Es(e, c), Ri(l, e, c), ah;
      return sm(u) || Vu(), Eu(
        e,
        t,
        T
      );
    }
    return sm(u) ? (t.flags |= 192, t.child = e.child, null) : (e = x.treeContext, Vt = ha(u.nextSibling), Yn = t, nt = !0, Bl = null, fa = !1, e !== null && Bg(t, e), t = ch(
      t,
      c.children
    ), t.flags |= 134221824, t);
  }
  function ay(e, t, i) {
    e.lanes |= t;
    var l = e.alternate;
    l !== null && (l.lanes |= t), nu(e.return, t, i);
  }
  function ly(e) {
    for (var t = null; e !== null; ) {
      var i = e.alternate;
      i !== null && fu(i) === null && (t = e), e = e.sibling;
    }
    return t;
  }
  function Nu(e, t, i, l, c, u) {
    var x = e.memoizedState;
    x === null ? e.memoizedState = {
      isBackwards: t,
      rendering: null,
      renderingStartTime: 0,
      last: l,
      tail: i,
      tailMode: c,
      treeForkCount: u
    } : (x.isBackwards = t, x.rendering = null, x.renderingStartTime = 0, x.last = l, x.tail = i, x.tailMode = c, x.treeForkCount = u);
  }
  function uh(e) {
    var t = e.child;
    for (e.child = null; t !== null; ) {
      var i = t.sibling;
      t.sibling = e.child, e.child = t, t = i;
    }
  }
  function fh(e, t, i) {
    var l = t.pendingProps, c = l.revealOrder, u = l.tail;
    l = l.children;
    var x = ti.current;
    if (t.flags & 128)
      return Do(t, x), null;
    var T = (x & 2) !== 0;
    if (T ? (x = x & 1 | 2, t.flags |= 128) : x &= 1, Do(t, x), c === "backwards" && e !== null ? (uh(e), Dn(e, t, l, i), uh(e)) : Dn(e, t, l, i), l = nt ? To : 0, !T && e !== null && (e.flags & 128) !== 0)
      e: for (e = t.child; e !== null; ) {
        if (e.tag === 13)
          e.memoizedState !== null && ay(e, i, t);
        else if (e.tag === 19)
          ay(e, i, t);
        else if (e.child !== null) {
          e.child.return = e, e = e.child;
          continue;
        }
        if (e === t) break e;
        for (; e.sibling === null; ) {
          if (e.return === null || e.return === t)
            break e;
          e = e.return;
        }
        e.sibling.return = e.return, e = e.sibling;
      }
    switch (c) {
      case "backwards":
        i = ly(t.child), i === null ? (c = t.child, t.child = null) : (c = i.sibling, i.sibling = null, uh(t)), Nu(
          t,
          !0,
          c,
          null,
          u,
          l
        );
        break;
      case "unstable_legacy-backwards":
        for (i = null, c = t.child, t.child = null; c !== null; ) {
          if (e = c.alternate, e !== null && fu(e) === null) {
            t.child = c;
            break;
          }
          e = c.sibling, c.sibling = i, i = c, c = e;
        }
        Nu(
          t,
          !0,
          i,
          null,
          u,
          l
        );
        break;
      case "together":
        Nu(
          t,
          !1,
          null,
          null,
          void 0,
          l
        );
        break;
      case "independent":
        t.memoizedState = null;
        break;
      default:
        i = ly(t.child), i === null ? (c = t.child, t.child = null) : (c = i.sibling, i.sibling = null), Nu(
          t,
          !1,
          c,
          i,
          u,
          l
        );
    }
    return t.child;
  }
  function sy(e, t, i) {
    var l = t.pendingProps;
    return ql(t, t.type, l.value), Dn(e, t, l.children, i), t.child;
  }
  function _l(e, t, i) {
    if (e !== null && (t.dependencies = e.dependencies), Fl |= t.lanes, (i & t.childLanes) === 0)
      if (e !== null) {
        if (As(
          e,
          t,
          i,
          !1
        ), (i & t.childLanes) === 0)
          return null;
      } else return null;
    if (e !== null && t.child !== e.child)
      throw Error(r(153));
    if (t.child !== null) {
      for (e = t.child, i = yl(e, e.pendingProps), t.child = i, i.return = t; e.sibling !== null; )
        e = e.sibling, i = i.sibling = yl(e, e.pendingProps), i.return = t;
      i.sibling = null;
    }
    return t.child;
  }
  function dh(e, t) {
    return (e.lanes & t) !== 0 ? !0 : (e = e.dependencies, !!(e !== null && iu(e)));
  }
  function M_(e, t, i) {
    switch (t.tag) {
      case 3:
        Et(t, t.stateNode.containerInfo), ql(t, _n, e.memoizedState.cache), Ts();
        break;
      case 27:
      case 5:
        It(t);
        break;
      case 4:
        Et(t, t.stateNode.containerInfo);
        break;
      case 10:
        ql(
          t,
          t.type,
          t.memoizedProps.value
        );
        break;
      case 31:
        if (t.memoizedState !== null)
          return t.flags |= 128, Ld(t), null;
        break;
      case 13:
        var l = t.memoizedState;
        if (l !== null) {
          if (l.dehydrated !== null)
            return Zl(t), t.flags |= 128, null;
          l = As(
            e,
            t,
            i,
            !1
          );
          var c = t.child.childLanes;
          return l || (i & c) !== 0 ? iy(e, t, i) : (Zl(t), e = _l(
            e,
            t,
            i
          ), e !== null ? e.sibling : null);
        }
        Zl(t);
        break;
      case 19:
        if (t.flags & 128)
          return fh(
            e,
            t,
            i
          );
        if (c = (e.flags & 128) !== 0, l = (i & t.childLanes) !== 0, l || (As(
          e,
          t,
          i,
          !1
        ), l = (i & t.childLanes) !== 0), c) {
          if (l)
            return fh(
              e,
              t,
              i
            );
          t.flags |= 128;
        }
        if (c = t.memoizedState, c !== null && (c.rendering = null, c.tail = null, c.lastEffect = null), Do(t, ti.current), l) break;
        return null;
      case 22:
        return t.lanes = 0, J0(
          e,
          t,
          i,
          t.pendingProps
        );
      case 24:
        ql(t, _n, e.memoizedState.cache);
    }
    return _l(e, t, i);
  }
  function ry(e, t, i) {
    if (e !== null)
      if (e.memoizedProps !== t.pendingProps)
        Nn = !0;
      else {
        if (!dh(e, i) && (t.flags & 128) === 0)
          return Nn = !1, M_(
            e,
            t,
            i
          );
        Nn = (e.flags & 131072) !== 0;
      }
    else
      Nn = !1, nt && (t.flags & 1048576) !== 0 && Ug(t, To, t.index);
    switch (t.lanes = 0, t.tag) {
      case 16:
        e: {
          var l = t.pendingProps;
          if (e = js(t.elementType), t.type = e, typeof e == "function")
            xd(e) ? (l = Hs(e, l), t.tag = 1, t = ty(
              null,
              t,
              e,
              l,
              i
            )) : (t.tag = 0, t = lh(
              null,
              t,
              e,
              l,
              i
            ));
          else {
            if (e != null) {
              var c = e.$$typeof;
              if (c === j) {
                t.tag = 11, t = Q0(
                  null,
                  t,
                  e,
                  l,
                  i
                );
                break e;
              } else if (c === J) {
                t.tag = 14, t = K0(
                  null,
                  t,
                  e,
                  l,
                  i
                );
                break e;
              } else if (c === Y) {
                t.tag = 10, t.type = e, t = sy(
                  null,
                  t,
                  i
                );
                break e;
              }
            }
            throw t = Te(e) || e, Error(r(306, t, ""));
          }
        }
        return t;
      case 0:
        return lh(
          e,
          t,
          t.type,
          t.pendingProps,
          i
        );
      case 1:
        return l = t.type, c = Hs(
          l,
          t.pendingProps
        ), ty(
          e,
          t,
          l,
          c,
          i
        );
      case 3:
        e: {
          if (Et(
            t,
            t.stateNode.containerInfo
          ), e === null) throw Error(r(387));
          l = t.pendingProps;
          var u = t.memoizedState;
          c = u.element, jd(e, t), Oo(t, l, null, i);
          var x = t.memoizedState;
          if (l = x.cache, ql(t, _n, l), l !== u.cache && Td(
            t,
            [_n],
            i,
            !0
          ), Ro(), l = x.element, u.isDehydrated)
            if (u = {
              element: l,
              isDehydrated: !1,
              cache: x.cache
            }, t.updateQueue.baseState = u, t.memoizedState = u, t.flags & 256) {
              t = ny(
                e,
                t,
                l,
                i
              );
              break e;
            } else if (l !== c) {
              c = oa(
                Error(r(424)),
                t
              ), Co(c), t = ny(
                e,
                t,
                l,
                i
              );
              break e;
            } else
              for (e = t.stateNode.containerInfo, e.nodeType === 9 ? e = e.body : e = e.nodeName === "HTML" ? e.ownerDocument.body : e, Vt = ha(e.firstChild), Yn = t, nt = !0, Bl = null, fa = !0, i = Jg(
                t,
                null,
                l,
                i
              ), t.child = i; i; )
                i.flags = i.flags & -3 | 134221824, i = i.sibling;
          else {
            if (Ts(), l === c) {
              t = _l(
                e,
                t,
                i
              );
              break e;
            }
            Dn(e, t, l, i);
          }
          t = t.child;
        }
        return t;
      case 26:
        return Cr(e, t), e === null ? (i = jv(
          t.type,
          null,
          t.pendingProps,
          null
        )) ? t.memoizedState = i : nt || (t.stateNode = fv(
          t.type,
          t.pendingProps,
          At.current,
          t
        )) : t.memoizedState = jv(
          t.type,
          e.memoizedProps,
          t.pendingProps,
          e.memoizedState
        ), null;
      case 27:
        return It(t), e === null && nt && (l = t.stateNode = Av(
          t.type,
          t.pendingProps,
          At.current
        ), Yn = t, fa = !0, c = Vt, ns(t.type) ? (om = c, Vt = ha(l.firstChild)) : Vt = c), Dn(
          e,
          t,
          t.pendingProps.children,
          i
        ), Cr(e, t), e === null && (t.flags |= 4194304), t.child;
      case 5:
        return e === null && nt && ((c = l = Vt) && (l = _2(
          l,
          t.type,
          t.pendingProps,
          fa
        ), l !== null ? (t.stateNode = l, Yn = t, Vt = ha(l.firstChild), fa = !1, c = !0) : c = !1), c || $l(t)), It(t), c = t.type, u = t.pendingProps, x = e !== null ? e.memoizedProps : null, l = u.children, Wh(c, u) ? l = null : x !== null && Wh(c, x) && (t.flags |= 32), t.memoizedState !== null && (c = $d(
          e,
          t,
          v_,
          null,
          null,
          i
        ), Xr._currentValue = c), Cr(e, t), Dn(e, t, l, i), t.child;
      case 6:
        return e === null && nt && ((e = i = Vt) && (i = E2(
          i,
          t.pendingProps,
          fa
        ), i !== null ? (t.stateNode = i, Yn = t, Vt = null, e = !0) : e = !1), e || $l(t)), null;
      case 13:
        return iy(e, t, i);
      case 4:
        return Et(
          t,
          t.stateNode.containerInfo
        ), l = t.pendingProps, e === null ? t.child = Os(
          t,
          null,
          l,
          i
        ) : Dn(e, t, l, i), t.child;
      case 11:
        return Q0(
          e,
          t,
          t.type,
          t.pendingProps,
          i
        );
      case 7:
        return l = t.pendingProps, Cr(e, t), Dn(e, t, l, i), t.child;
      case 8:
        return Dn(
          e,
          t,
          t.pendingProps.children,
          i
        ), t.child;
      case 12:
        return Dn(
          e,
          t,
          t.pendingProps.children,
          i
        ), t.child;
      case 10:
        return sy(e, t, i);
      case 9:
        return c = t.type._context, l = t.pendingProps.children, Ms(t), c = Wn(c), l = l(c), t.flags |= 1, Dn(e, t, l, i), t.child;
      case 14:
        return K0(
          e,
          t,
          t.type,
          t.pendingProps,
          i
        );
      case 15:
        return P0(
          e,
          t,
          t.type,
          t.pendingProps,
          i
        );
      case 19:
        return fh(e, t, i);
      case 31:
        return C_(e, t, i);
      case 22:
        return J0(
          e,
          t,
          i,
          t.pendingProps
        );
      case 24:
        return Ms(t), l = Wn(_n), e === null ? (c = Md(), c === null && (c = Ut, u = Cd(), c.pooledCache = u, u.refCount++, u !== null && (c.pooledCacheLanes |= i), c = u), t.memoizedState = { parent: l, cache: c }, kd(t), ql(t, _n, c)) : ((e.lanes & i) !== 0 && (jd(e, t), Oo(t, null, null, i), Ro()), c = e.memoizedState, u = t.memoizedState, c.parent !== l ? (c = { parent: l, cache: l }, t.memoizedState = c, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = c), ql(t, _n, l)) : (l = u.cache, ql(t, _n, l), l !== c.cache && Td(
          t,
          [_n],
          i,
          !0
        ))), Dn(
          e,
          t,
          t.pendingProps.children,
          i
        ), t.child;
      case 30:
        return t.stateNode === null && (t.stateNode = {
          autoName: null,
          paired: null,
          clones: null,
          ref: null
        }), l = t.pendingProps, l.name != null && l.name !== "auto" ? t.flags |= e === null ? 18882560 : 18874368 : nt && eu(t), e !== null && e.memoizedProps.name !== l.name ? t.flags |= 4194816 : Cr(e, t), Dn(e, t, l.children, i), t.child;
      case 29:
        throw t.pendingProps;
    }
    throw Error(r(156, t.tag));
  }
  function El(e) {
    e.flags |= 4;
  }
  function hh(e, t, i, l, c) {
    var u;
    if ((u = (e.mode & 32) !== 0) && (u = i === null ? Hv(t, l) : Hv(t, l) && (l.src !== i.src || l.srcSet !== i.srcSet)), u) {
      if (e.flags |= 16777216, (c & 335544128) === c)
        if (e.stateNode.complete) e.flags |= 8192;
        else if (Vy()) e.flags |= 8192;
        else
          throw Rs = ru, zd;
    } else e.flags &= -16777217;
  }
  function oy(e, t) {
    if (t.type !== "stylesheet" || (t.state.loading & 4) !== 0)
      e.flags &= -16777217;
    else if (e.flags |= 16777216, !Lv(t))
      if (Vy()) e.flags |= 8192;
      else
        throw Rs = ru, zd;
  }
  function Tu(e, t) {
    t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag !== 22 ? Ln() : 536870912, e.lanes |= t, jr |= t);
  }
  function $o(e, t) {
    if (!nt)
      switch (e.tailMode) {
        case "visible":
          break;
        case "collapsed":
          for (var i = e.tail, l = null; i !== null; )
            i.alternate !== null && (l = i), i = i.sibling;
          l === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : l.sibling = null;
          break;
        default:
          for (t = e.tail, i = null; t !== null; )
            t.alternate !== null && (i = t), t = t.sibling;
          i === null ? e.tail = null : i.sibling = null;
      }
  }
  function Yt(e) {
    var t = e.alternate !== null && e.alternate.child === e.child, i = 0, l = 0;
    if (t)
      for (var c = e.child; c !== null; )
        i |= c.lanes | c.childLanes, l |= c.subtreeFlags & 1206910976, l |= c.flags & 1206910976, c.return = e, c = c.sibling;
    else
      for (c = e.child; c !== null; )
        i |= c.lanes | c.childLanes, l |= c.subtreeFlags, l |= c.flags, c.return = e, c = c.sibling;
    return e.subtreeFlags |= l, e.childLanes = i, t;
  }
  function z_(e, t, i) {
    var l = t.pendingProps;
    switch (wd(t), t.tag) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return Yt(t), null;
      case 1:
        return Yt(t), null;
      case 3:
        return i = t.stateNode, l = null, e !== null && (l = e.memoizedState.cache), t.memoizedState.cache !== l && (t.flags |= 2048), bl(_n), sn(), i.pendingContext && (i.context = i.pendingContext, i.pendingContext = null), (e === null || e.child === null) && (br(t) ? El(t) : e === null || e.memoizedState.isDehydrated && (t.flags & 256) === 0 || (t.flags |= 1024, Ed())), Yt(t), null;
      case 26:
        var c = t.type, u = t.memoizedState;
        return e === null ? (El(t), u !== null ? (Yt(t), oy(t, u)) : (Yt(t), hh(
          t,
          c,
          null,
          l,
          i
        ))) : u ? u !== e.memoizedState ? (El(t), Yt(t), oy(t, u)) : (Yt(t), t.flags &= -16777217) : (e = e.memoizedProps, e !== l && El(t), Yt(t), hh(
          t,
          c,
          e,
          l,
          i
        )), null;
      case 27:
        if (bt(t), i = At.current, c = t.type, e !== null && t.stateNode != null)
          e.memoizedProps !== l && El(t);
        else {
          if (!l) {
            if (t.stateNode === null)
              throw Error(r(166));
            return Yt(t), t.subtreeFlags &= -33554433, null;
          }
          e = _t.current, br(t) ? $g(t) : (e = Av(c, l, i), t.stateNode = e, El(t));
        }
        return Yt(t), t.subtreeFlags &= -33554433, null;
      case 5:
        if (bt(t), c = t.type, e !== null && t.stateNode != null)
          e.memoizedProps !== l && El(t);
        else {
          if (!l) {
            if (t.stateNode === null)
              throw Error(r(166));
            return Yt(t), t.subtreeFlags &= -33554433, null;
          }
          if (u = _t.current, br(t))
            $g(t);
          else {
            var x = Jo(
              At.current
            );
            switch (u) {
              case 1:
                u = x.createElementNS(
                  "http://www.w3.org/2000/svg",
                  c
                );
                break;
              case 2:
                u = x.createElementNS(
                  "http://www.w3.org/1998/Math/MathML",
                  c
                );
                break;
              default:
                switch (c) {
                  case "svg":
                    u = x.createElementNS(
                      "http://www.w3.org/2000/svg",
                      c
                    );
                    break;
                  case "math":
                    u = x.createElementNS(
                      "http://www.w3.org/1998/Math/MathML",
                      c
                    );
                    break;
                  case "script":
                    u = x.createElement("div"), u.innerHTML = "<script><\/script>", u = u.removeChild(
                      u.firstChild
                    );
                    break;
                  case "select":
                    u = typeof l.is == "string" ? x.createElement("select", {
                      is: l.is
                    }) : x.createElement("select"), l.multiple ? u.multiple = !0 : l.size && (u.size = l.size);
                    break;
                  default:
                    u = typeof l.is == "string" ? x.createElement(c, { is: l.is }) : x.createElement(c);
                }
            }
            u[qt] = t, u[bn] = l;
            e: for (x = t.child; x !== null; ) {
              if (x.tag === 5 || x.tag === 6)
                u.appendChild(x.stateNode);
              else if (x.tag !== 4 && x.tag !== 27 && x.child !== null) {
                x.child.return = x, x = x.child;
                continue;
              }
              if (x === t) break e;
              for (; x.sibling === null; ) {
                if (x.return === null || x.return === t)
                  break e;
                x = x.return;
              }
              x.sibling.return = x.return, x = x.sibling;
            }
            t.stateNode = u;
            e: switch (ii(u, c, l), c) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                l = !!l.autoFocus;
                break e;
              case "img":
                l = !0;
                break e;
              default:
                l = !1;
            }
            l && El(t);
          }
        }
        return Yt(t), t.subtreeFlags &= -33554433, hh(
          t,
          t.type,
          e === null ? null : e.memoizedProps,
          t.pendingProps,
          i
        ), null;
      case 6:
        if (e && t.stateNode != null)
          e.memoizedProps !== l && El(t);
        else {
          if (typeof l != "string" && t.stateNode === null)
            throw Error(r(166));
          if (e = At.current, br(t)) {
            if (e = t.stateNode, i = t.memoizedProps, l = null, c = Yn, c !== null)
              switch (c.tag) {
                case 27:
                case 5:
                  l = c.memoizedProps;
              }
            e[qt] = t, e = !!(e.nodeValue === i || l !== null && l.suppressHydrationWarning === !0 || rv(e.nodeValue, i)), e || $l(t, !0);
          } else
            e = Jo(e).createTextNode(
              l
            ), e[qt] = t, t.stateNode = e;
        }
        return Yt(t), null;
      case 31:
        if (i = t.memoizedState, e === null || e.memoizedState !== null) {
          if (l = br(t), i !== null) {
            if (e === null) {
              if (!l) throw Error(r(318));
              if (e = t.memoizedState, e = e !== null ? e.dehydrated : null, !e) throw Error(r(557));
              e[qt] = t;
            } else
              Ts(), (t.flags & 128) === 0 && (t.memoizedState = null), t.flags |= 4;
            Yt(t), e = !1;
          } else
            i = Ed(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = i), e = !0;
          if (!e)
            return t.flags & 256 ? (Ii(t), t) : (Ii(t), null);
          if ((t.flags & 128) !== 0)
            throw Error(r(558));
        }
        return Yt(t), null;
      case 13:
        if (l = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
          if (c = br(t), l !== null && l.dehydrated !== null) {
            if (e === null) {
              if (!c) throw Error(r(318));
              if (c = t.memoizedState, c = c !== null ? c.dehydrated : null, !c) throw Error(r(317));
              c[qt] = t;
            } else
              Ts(), (t.flags & 128) === 0 && (t.memoizedState = null), t.flags |= 4;
            Yt(t), c = !1;
          } else
            c = Ed(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = c), c = !0;
          if (!c)
            return t.flags & 256 ? (Ii(t), t) : (Ii(t), null);
        }
        return Ii(t), (t.flags & 128) !== 0 ? (t.lanes = i, t) : (i = l !== null, e = e !== null && e.memoizedState !== null, i && (l = t.child, c = null, l.alternate !== null && l.alternate.memoizedState !== null && l.alternate.memoizedState.cachePool !== null && (c = l.alternate.memoizedState.cachePool.pool), u = null, l.memoizedState !== null && l.memoizedState.cachePool !== null && (u = l.memoizedState.cachePool.pool), u !== c && (l.flags |= 2048)), i !== e && i && (t.child.flags |= 8192), Tu(t, t.updateQueue), Yt(t), null);
      case 4:
        return sn(), e === null && Qh(t.stateNode.containerInfo), t.flags |= 67108864, Yt(t), null;
      case 10:
        return bl(t.type), Yt(t), null;
      case 19:
        if (Ud(t), l = t.memoizedState, l === null) return Yt(t), null;
        if (c = (t.flags & 128) !== 0, u = l.rendering, u === null)
          if (c) $o(l, !1);
          else {
            if (un !== 0 || e !== null && (e.flags & 128) !== 0)
              for (e = t.child; e !== null; ) {
                if (u = fu(e), u !== null) {
                  for (t.flags |= 128, $o(l, !1), e = u.updateQueue, t.updateQueue = e, Tu(t, e), t.subtreeFlags = 0, e = i, i = t.child; i !== null; )
                    Dg(i, e), i = i.sibling;
                  return Do(
                    t,
                    ti.current & 1 | 2
                  ), nt && vl(t, l.treeForkCount), t.child;
                }
                e = e.sibling;
              }
            l.tail !== null && Zt() > Uu && (t.flags |= 128, c = !0, $o(l, !1), t.lanes = 4194304);
          }
        else {
          if (!c)
            if (e = fu(u), e !== null) {
              if (t.flags |= 128, c = !0, e = e.updateQueue, t.updateQueue = e, Tu(t, e), $o(l, !0), l.tail === null && l.tailMode !== "collapsed" && l.tailMode !== "visible" && !u.alternate && !nt)
                return Yt(t), null;
            } else
              2 * Zt() - l.renderingStartTime > Uu && i !== 536870912 && (t.flags |= 128, c = !0, $o(l, !1), t.lanes = 4194304);
          l.isBackwards ? (u.sibling = t.child, t.child = u) : (e = l.last, e !== null ? e.sibling = u : t.child = u, l.last = u);
        }
        if (l.tail !== null) {
          e = l.tail;
          e: {
            for (i = e; i !== null; ) {
              if (i.alternate !== null) {
                i = !1;
                break e;
              }
              i = i.sibling;
            }
            i = !0;
          }
          return l.rendering = e, l.tail = e.sibling, l.renderingStartTime = Zt(), e.sibling = null, u = ti.current, u = c ? u & 1 | 2 : u & 1, l.tailMode === "visible" || l.tailMode === "collapsed" || !i || nt ? Do(t, u) : (i = u, Re(ei, t), Re(ti, i), mi === null && (mi = t)), nt && vl(t, l.treeForkCount), e;
        }
        return Yt(t), null;
      case 22:
      case 23:
        return Ii(t), Hd(), l = t.memoizedState !== null, e !== null ? e.memoizedState !== null !== l && (t.flags |= 8192) : l && (t.flags |= 8192), l ? (i & 536870912) !== 0 && (t.flags & 128) === 0 && (Yt(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : Yt(t), i = t.updateQueue, i !== null && Tu(t, i.retryQueue), i = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (i = e.memoizedState.cachePool.pool), l = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (l = t.memoizedState.cachePool.pool), l !== i && (t.flags |= 2048), e !== null && Ge(ks), null;
      case 24:
        return i = null, e !== null && (i = e.memoizedState.cache), t.memoizedState.cache !== i && (t.flags |= 2048), bl(_n), Yt(t), null;
      case 25:
        return null;
      case 30:
        return t.flags |= 33554432, Yt(t), null;
    }
    throw Error(r(156, t.tag));
  }
  function k_(e, t) {
    switch (wd(t), t.tag) {
      case 1:
        return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 3:
        return bl(_n), sn(), e = t.flags, (e & 65536) !== 0 && (e & 128) === 0 ? (t.flags = e & -65537 | 128, t) : null;
      case 26:
      case 27:
      case 5:
        return bt(t), null;
      case 31:
        if (t.memoizedState !== null) {
          if (Ii(t), t.alternate === null)
            throw Error(r(340));
          Ts();
        }
        return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 13:
        if (Ii(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
          if (t.alternate === null)
            throw Error(r(340));
          Ts();
        }
        return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 19:
        return Ud(t), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, e = t.memoizedState, e !== null && (e.rendering = null, e.tail = null), t.flags |= 4, t) : null;
      case 4:
        return sn(), null;
      case 10:
        return bl(t.type), null;
      case 22:
      case 23:
        return Ii(t), Hd(), e !== null && Ge(ks), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
      case 24:
        return bl(_n), null;
      case 25:
        return null;
      default:
        return null;
    }
  }
  function cy(e, t) {
    switch (wd(t), t.tag) {
      case 3:
        bl(_n), sn();
        break;
      case 26:
      case 27:
      case 5:
        bt(t);
        break;
      case 4:
        sn();
        break;
      case 31:
        t.memoizedState !== null && Ii(t);
        break;
      case 13:
        Ii(t);
        break;
      case 19:
        Ud(t);
        break;
      case 10:
        bl(t.type);
        break;
      case 22:
      case 23:
        Ii(t), Hd(), e !== null && Ge(ks);
        break;
      case 24:
        bl(_n);
    }
  }
  function qo(e, t) {
    try {
      var i = t.updateQueue, l = i !== null ? i.lastEffect : null;
      if (l !== null) {
        var c = l.next;
        i = c;
        do {
          if ((i.tag & e) === e) {
            l = void 0;
            var u = i.create, x = i.inst;
            l = u(), x.destroy = l;
          }
          i = i.next;
        } while (i !== c);
      }
    } catch (T) {
      jt(t, t.return, T);
    }
  }
  function Kl(e, t, i) {
    try {
      var l = t.updateQueue, c = l !== null ? l.lastEffect : null;
      if (c !== null) {
        var u = c.next;
        l = u;
        do {
          if ((l.tag & e) === e) {
            var x = l.inst, T = x.destroy;
            if (T !== void 0) {
              x.destroy = void 0, c = t;
              var $ = i, ie = T;
              try {
                ie();
              } catch (fe) {
                jt(
                  c,
                  $,
                  fe
                );
              }
            }
          }
          l = l.next;
        } while (l !== u);
      }
    } catch (fe) {
      jt(t, t.return, fe);
    }
  }
  function uy(e) {
    var t = e.updateQueue;
    if (t !== null) {
      var i = e.stateNode;
      try {
        Wg(t, i);
      } catch (l) {
        jt(e, e.return, l);
      }
    }
  }
  function fy(e, t, i) {
    i.props = Hs(
      e.type,
      e.memoizedProps
    ), i.state = e.memoizedState;
    try {
      i.componentWillUnmount();
    } catch (l) {
      jt(e, t, l);
    }
  }
  function Pa(e, t) {
    try {
      var i = e.ref;
      if (i !== null) {
        switch (e.tag) {
          case 26:
          case 27:
          case 5:
            var l = e.stateNode;
            break;
          case 30:
            var c = e.stateNode, u = pl(e.memoizedProps, c);
            (c.ref === null || c.ref.name !== u) && (c.ref = vv(u)), l = c.ref;
            break;
          case 7:
            if (e.stateNode === null) {
              var x = new Ki(e);
              p(
                e.child,
                !1,
                S2,
                x,
                void 0,
                void 0
              ), e.stateNode = x;
            }
            l = e.stateNode;
            break;
          default:
            l = e.stateNode;
        }
        typeof i == "function" ? e.refCleanup = i(l) : i.current = l;
      }
    } catch (T) {
      jt(e, t, T);
    }
  }
  function ni(e, t) {
    var i = e.ref, l = e.refCleanup;
    if (i !== null)
      if (typeof l == "function")
        try {
          l();
        } catch (c) {
          jt(e, t, c);
        } finally {
          e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
        }
      else if (typeof i == "function")
        try {
          i(null);
        } catch (c) {
          jt(e, t, c);
        }
      else i.current = null;
  }
  function Cu(e, t) {
    if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && e.alternate === null && t !== null)
      for (var i = 0; i < t.length; i++)
        Ev(
          e.stateNode,
          t[i]
        );
  }
  function dy(e) {
    for (var t = e.return; t !== null && (ph(t) && Ev(e.stateNode, t.stateNode), !mh(t)); )
      t = t.return;
  }
  function Vo(e) {
    for (var t = e.return; t !== null && (ph(t) && w2(e.stateNode, t.stateNode), !mh(t)); )
      t = t.return;
  }
  function mh(e) {
    return e.tag === 5 || e.tag === 3 || e.tag === 27;
  }
  function ph(e) {
    return e && e.tag === 7 && e.stateNode !== null;
  }
  function gh(e) {
    var t = e.type, i = e.memoizedProps, l = e.stateNode;
    try {
      e: switch (t) {
        case "button":
        case "input":
        case "select":
        case "textarea":
          i.autoFocus && l.focus();
          break e;
        case "img":
          i.src ? l.src = i.src : i.srcSet && (l.srcset = i.srcSet);
      }
    } catch (c) {
      jt(e, e.return, c);
    }
  }
  function yh(e, t, i) {
    try {
      var l = e.stateNode;
      i2(l, e.type, i, t), l[bn] = t;
    } catch (c) {
      jt(e, e.return, c);
    }
  }
  function hy(e) {
    return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && ns(e.type) || e.tag === 4;
  }
  function vh(e) {
    e: for (; ; ) {
      for (; e.sibling === null; ) {
        if (e.return === null || hy(e.return)) return null;
        e = e.return;
      }
      for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18; ) {
        if (e.tag === 27 && ns(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue e;
        e.child.return = e, e = e.child;
      }
      if (!(e.flags & 2)) return e.stateNode;
    }
  }
  function xh(e, t, i, l) {
    var c = e.tag;
    if (c === 5 || c === 6)
      c = e.stateNode, t ? (i.nodeType === 9 ? i.body : i.nodeName === "HTML" ? i.ownerDocument.body : i).insertBefore(c, t) : (t = i.nodeType === 9 ? i.body : i.nodeName === "HTML" ? i.ownerDocument.body : i, t.appendChild(c), i = i._reactRootContainer, i != null || t.onclick !== null || (t.onclick = vt)), Cu(e, l), Ke = !0;
    else if (c !== 4 && (c === 27 && (Cu(e, l), l = null, ns(e.type) && (i = e.stateNode, t = null)), e = e.child, e !== null))
      for (xh(
        e,
        t,
        i,
        l
      ), e = e.sibling; e !== null; )
        xh(
          e,
          t,
          i,
          l
        ), e = e.sibling;
  }
  function Au(e, t, i, l) {
    var c = e.tag;
    if (c === 5 || c === 6)
      c = e.stateNode, t ? i.insertBefore(c, t) : i.appendChild(c), Cu(e, l), Ke = !0;
    else if (c !== 4 && (c === 27 && (Cu(e, l), l = null, ns(e.type) && (i = e.stateNode)), e = e.child, e !== null))
      for (Au(
        e,
        t,
        i,
        l
      ), e = e.sibling; e !== null; )
        Au(
          e,
          t,
          i,
          l
        ), e = e.sibling;
  }
  function my(e) {
    var t = e.stateNode, i = e.memoizedProps;
    try {
      for (var l = e.type, c = t.attributes; c.length; )
        t.removeAttributeNode(c[0]);
      ii(t, l, i), t[qt] = e, t[bn] = i;
    } catch (u) {
      jt(e, e.return, u);
    }
  }
  var Mu = !1, Xi = null;
  function py(e) {
    (e.tag === 30 || (e.subtreeFlags & 33554432) !== 0) && (Mu = !0);
  }
  var Ja = null;
  function gy() {
    var e = Ja;
    return Ja = null, e;
  }
  var zi = 0;
  function Ar(e, t, i, l, c) {
    return zi = 0, yy(
      e.child,
      t,
      i,
      l,
      c
    );
  }
  function yy(e, t, i, l, c) {
    for (var u = !1; e !== null; ) {
      if (e.tag === 5) {
        var x = e.stateNode;
        if (l !== null) {
          var T = nm(x);
          l.push(T), T.view && (u = !0);
        } else
          u || nm(x).view && (u = !0);
        Mu = !0, gv(
          x,
          zi === 0 ? t : t + "_" + zi,
          i
        ), zi++;
      } else (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && c || yy(
        e.child,
        t,
        i,
        l,
        c
      ) && (u = !0));
      e = e.sibling;
    }
    return u;
  }
  function Fa(e, t) {
    for (; e !== null; )
      e.tag === 5 ? yv(e.stateNode, e.memoizedProps) : (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && t || Fa(
        e.child,
        t
      )), e = e.sibling;
  }
  function zu(e) {
    if ((e.subtreeFlags & 18874368) !== 0)
      for (e = e.child; e !== null; ) {
        if ((e.tag !== 22 || e.memoizedState === null) && (zu(e), e.tag === 30 && (e.flags & 18874368) !== 0 && e.stateNode.paired)) {
          var t = e.memoizedProps;
          if (t.name == null || t.name === "auto")
            throw Error(r(544));
          var i = t.name;
          t = gl(t.default, t.share), t !== "none" && (Ar(
            e,
            i,
            t,
            null,
            !1
          ) || Fa(e.child, !1));
        }
        e = e.sibling;
      }
  }
  function bh(e, t) {
    if (e.tag === 30) {
      var i = e.stateNode, l = e.memoizedProps, c = pl(l, i), u = gl(
        l.default,
        i.paired ? l.share : l.enter
      );
      u !== "none" ? Ar(e, c, u, null, !1) ? (zu(e), i.paired || t || Hr(e, l.onEnter)) : Fa(e.child, !1) : zu(e);
    } else if ((e.subtreeFlags & 33554432) !== 0)
      for (e = e.child; e !== null; )
        bh(e, t), e = e.sibling;
    else zu(e);
  }
  function Sh(e) {
    if (Xi !== null && Xi.size !== 0) {
      var t = Xi;
      if ((e.subtreeFlags & 18874368) !== 0)
        for (e = e.child; e !== null; ) {
          if (e.tag !== 22 || e.memoizedState === null) {
            if (e.tag === 30 && (e.flags & 18874368) !== 0) {
              var i = e.memoizedProps, l = i.name;
              if (l != null && l !== "auto") {
                var c = t.get(l);
                if (c !== void 0) {
                  var u = gl(
                    i.default,
                    i.share
                  );
                  if (u !== "none" && (Ar(
                    e,
                    l,
                    u,
                    null,
                    !1
                  ) ? (u = e.stateNode, c.paired = u, u.paired = c, Hr(e, i.onShare)) : Fa(e.child, !1)), t.delete(l), t.size === 0) break;
                }
              }
            }
            Sh(e);
          }
          e = e.sibling;
        }
    }
  }
  function wh(e) {
    if (e.tag === 30) {
      var t = e.memoizedProps, i = pl(t, e.stateNode), l = Xi !== null ? Xi.get(i) : void 0, c = gl(
        t.default,
        l !== void 0 ? t.share : t.exit
      );
      c !== "none" && (Ar(e, i, c, null, !1) ? l !== void 0 ? (c = e.stateNode, l.paired = c, c.paired = l, Xi.delete(i), Hr(e, t.onShare)) : Hr(e, t.onExit) : Fa(e.child, !1)), Xi !== null && Sh(e);
    } else if ((e.subtreeFlags & 33554432) !== 0)
      for (e = e.child; e !== null; )
        wh(e), e = e.sibling;
    else
      Xi !== null && Sh(e);
  }
  function vy(e) {
    for (e = e.child; e !== null; ) {
      if (e.tag === 30) {
        var t = e.memoizedProps, i = pl(t, e.stateNode);
        t = gl(t.default, t.update), e.flags &= -5, t !== "none" && Ar(
          e,
          i,
          t,
          e.memoizedState = [],
          !1
        );
      } else
        (e.subtreeFlags & 33554432) !== 0 && vy(e);
      e = e.sibling;
    }
  }
  function _h(e) {
    if ((e.subtreeFlags & 18874368) !== 0)
      for (e = e.child; e !== null; ) {
        if (e.tag !== 22 || e.memoizedState === null) {
          if (e.tag === 30 && (e.flags & 18874368) !== 0) {
            var t = e.stateNode;
            t.paired !== null && (t.paired = null, Fa(e.child, !1));
          }
          _h(e);
        }
        e = e.sibling;
      }
  }
  function ku(e) {
    if (e.tag === 30)
      e.stateNode.paired = null, Fa(e.child, !1), _h(e);
    else if ((e.subtreeFlags & 33554432) !== 0)
      for (e = e.child; e !== null; )
        ku(e), e = e.sibling;
    else _h(e);
  }
  function xy(e) {
    for (e = e.child; e !== null; )
      e.tag === 30 ? Fa(e.child, !1) : (e.subtreeFlags & 33554432) !== 0 && xy(e), e = e.sibling;
  }
  function Eh(e, t, i, l, c, u, x) {
    for (var T = !1; t !== null; ) {
      if (t.tag === 5) {
        var $ = t.stateNode;
        if (u !== null && zi < u.length) {
          var ie = u[zi], fe = nm($);
          (ie.view || fe.view) && (T = !0);
          var ve;
          if (ve = (e.flags & 4) === 0)
            if (fe.clip) ve = !0;
            else {
              ve = ie.rect;
              var W = fe.rect;
              ve = ve.y !== W.y || ve.x !== W.x || ve.height !== W.height || ve.width !== W.width;
            }
          ve && (e.flags |= 4), fe.abs ? fe = !ie.abs : (ie = ie.rect, fe = fe.rect, fe = ie.height !== fe.height || ie.width !== fe.width), fe && (e.flags |= 32);
        } else e.flags |= 32;
        (e.flags & 4) !== 0 && gv(
          $,
          zi === 0 ? i : i + "_" + zi,
          c
        ), T && (e.flags & 4) !== 0 || (Ja === null && (Ja = []), Ja.push(
          $,
          zi === 0 ? l : l + "_" + zi,
          t.memoizedProps
        )), zi++;
      } else (t.tag !== 22 || t.memoizedState === null) && (t.tag === 30 && x ? e.flags |= t.flags & 32 : Eh(
        e,
        t.child,
        i,
        l,
        c,
        u,
        x
      ) && (T = !0));
      t = t.sibling;
    }
    return T;
  }
  function by(e, t) {
    for (e = e.child; e !== null; ) {
      if (e.tag === 30) {
        var i = e.memoizedProps, l = e.stateNode, c = pl(i, l), u = gl(i.default, i.update), x;
        x = e.memoizedState, e.memoizedState = null, l = e;
        var T = e.child;
        zi = 0, c = Eh(
          l,
          T,
          c,
          c,
          u,
          x,
          !1
        ), (e.flags & 4) !== 0 && c && Hr(e, i.onUpdate);
      } else
        (e.subtreeFlags & 33554432) !== 0 && by(e);
      e = e.sibling;
    }
  }
  var In = !1, Ct = !1, Wa = !1, Nh = !1, Sy = typeof WeakSet == "function" ? WeakSet : Set, Xn = null, el = !1, Yo = !1, ju = !1, Th = !1;
  function j_(e, t, i) {
    if (e = e.containerInfo, Jh = Gr, e = Ng(e), dd(e)) {
      if ("selectionStart" in e)
        var l = {
          start: e.selectionStart,
          end: e.selectionEnd
        };
      else
        e: {
          l = (l = e.ownerDocument) && l.defaultView || window;
          var c = l.getSelection && l.getSelection();
          if (c && c.rangeCount !== 0) {
            l = c.anchorNode;
            var u = c.anchorOffset, x = c.focusNode;
            c = c.focusOffset;
            try {
              l.nodeType, x.nodeType;
            } catch {
              l = null;
              break e;
            }
            var T = 0, $ = -1, ie = -1, fe = 0, ve = 0, W = e, ue = null;
            t: for (; ; ) {
              for (var Ae; W !== l || u !== 0 && W.nodeType !== 3 || ($ = T + u), W !== x || c !== 0 && W.nodeType !== 3 || (ie = T + c), W.nodeType === 3 && (T += W.nodeValue.length), (Ae = W.firstChild) !== null; )
                ue = W, W = Ae;
              for (; ; ) {
                if (W === e) break t;
                if (ue === l && ++fe === u && ($ = T), ue === x && ++ve === c && (ie = T), (Ae = W.nextSibling) !== null) break;
                W = ue, ue = W.parentNode;
              }
              W = Ae;
            }
            l = $ === -1 || ie === -1 ? null : { start: $, end: ie };
          } else l = null;
        }
      l = l || { start: 0, end: 0 };
    } else l = null;
    for (Fh = { focusedElem: e, selectionRange: l }, Gr = !1, i = (i & 335544064) === i, Xn = t, t = i ? 9270 : 1024; Xn !== null; ) {
      if (e = Xn, i && (l = e.deletions, l !== null))
        for (u = 0; u < l.length; u++)
          i && wh(l[u]);
      if (e.alternate === null && (e.flags & 2) !== 0)
        i && py(e), Ru(i);
      else {
        if (e.tag === 22) {
          if (l = e.alternate, e.memoizedState !== null) {
            l !== null && l.memoizedState === null && i && wh(l), Ru(i);
            continue;
          } else if (l !== null && l.memoizedState !== null) {
            i && py(e), Ru(i);
            continue;
          }
        }
        l = e.child, (e.subtreeFlags & t) !== 0 && l !== null ? (l.return = e, Xn = l) : (i && vy(e), Ru(i));
      }
    }
    Xi = null;
  }
  function Ru(e) {
    for (; Xn !== null; ) {
      var t = Xn, i = e, l = t.alternate, c = t.flags;
      switch (t.tag) {
        case 0:
        case 11:
        case 15:
          break;
        case 1:
          if ((c & 1024) !== 0 && l !== null) {
            i = void 0, c = l.memoizedProps, l = l.memoizedState;
            var u = t.stateNode;
            try {
              var x = Hs(
                t.type,
                c
              );
              i = u.getSnapshotBeforeUpdate(
                x,
                l
              ), u.__reactInternalSnapshotBeforeUpdate = i;
            } catch (T) {
              jt(t, t.return, T);
            }
          }
          break;
        case 3:
          if ((c & 1024) !== 0) {
            if (l = t.stateNode.containerInfo, i = l.nodeType, i === 9)
              lm(l);
            else if (i === 1)
              switch (l.nodeName) {
                case "HEAD":
                case "HTML":
                case "BODY":
                  lm(l);
                  break;
                default:
                  l.textContent = "";
              }
          }
          break;
        case 5:
        case 26:
        case 27:
        case 6:
        case 4:
        case 17:
          break;
        case 30:
          i && l !== null && (i = pl(
            l.memoizedProps,
            l.stateNode
          ), c = t.memoizedProps, c = gl(c.default, c.update), c !== "none" && Ar(
            l,
            i,
            c,
            l.memoizedState = [],
            !0
          ));
          break;
        default:
          if ((c & 1024) !== 0) throw Error(r(163));
      }
      if (l = t.sibling, l !== null) {
        l.return = t.return, Xn = l;
        break;
      }
      Xn = t.return;
    }
  }
  function wy(e, t, i) {
    var l = i.flags;
    switch (i.tag) {
      case 0:
      case 11:
      case 15:
        tl(e, i), l & 4 && qo(5, i);
        break;
      case 1:
        if (tl(e, i), l & 4)
          if (e = i.stateNode, t === null)
            try {
              e.componentDidMount();
            } catch (x) {
              jt(i, i.return, x);
            }
          else {
            var c = Hs(
              i.type,
              t.memoizedProps
            );
            t = t.memoizedState;
            try {
              e.componentDidUpdate(
                c,
                t,
                e.__reactInternalSnapshotBeforeUpdate
              );
            } catch (x) {
              jt(
                i,
                i.return,
                x
              );
            }
          }
        l & 64 && uy(i), l & 512 && Pa(i, i.return);
        break;
      case 3:
        if (tl(e, i), l & 64 && (e = i.updateQueue, e !== null)) {
          if (t = null, i.child !== null)
            switch (i.child.tag) {
              case 27:
              case 5:
                t = i.child.stateNode;
                break;
              case 1:
                t = i.child.stateNode;
            }
          try {
            Wg(e, t);
          } catch (x) {
            jt(i, i.return, x);
          }
        }
        break;
      case 27:
        t === null && l & 4 && my(i);
      case 26:
      case 5:
        tl(e, i), t === null && l & 4 && gh(i), l & 512 && Pa(i, i.return);
        break;
      case 12:
        tl(e, i);
        break;
      case 31:
        tl(e, i), l & 4 && Ty(e, i);
        break;
      case 13:
        tl(e, i), l & 4 && Cy(e, i), l & 64 && (e = i.memoizedState, e !== null && (e = e.dehydrated, e !== null && (i = I_.bind(
          null,
          i
        ), N2(e, i))));
        break;
      case 22:
        if (l = i.memoizedState !== null || In, !l) {
          var u = t !== null && t.memoizedState !== null || Ct;
          t = In, c = Ct, In = l, (Ct = u) && !c ? (l = 2, (i.subtreeFlags & 8772) !== 0 && (l |= 1), Aa(
            e,
            i,
            l
          )) : tl(e, i), In = t, Ct = c;
        }
        break;
      case 30:
        tl(e, i), l & 512 && Pa(i, i.return);
        break;
      case 7:
        l & 512 && Pa(i, i.return);
      default:
        tl(e, i);
    }
  }
  function Ch(e, t) {
    for (e = e.child; e !== null; )
      _y(e, t), e = e.sibling;
  }
  function _y(e, t) {
    switch (e.tag) {
      case 5:
      case 26:
        try {
          var i = e.stateNode;
          if (t) {
            var l = i.style;
            typeof l.setProperty == "function" ? l.setProperty("display", "none", "important") : l.display = "none";
          } else {
            var c = e.stateNode, u = e.memoizedProps.style, x = u != null && u.hasOwnProperty("display") ? u.display : null;
            c.style.display = x == null || typeof x == "boolean" ? "" : ("" + x).trim();
          }
        } catch ($) {
          jt(e, e.return, $);
        }
        Ah(e, t);
        break;
      case 6:
        try {
          e.stateNode.nodeValue = t ? "" : e.memoizedProps, Ke = !0;
        } catch ($) {
          jt(e, e.return, $);
        }
        break;
      case 18:
        try {
          var T = e.stateNode;
          t ? pv(T, !0) : pv(e.stateNode, !1);
        } catch ($) {
          jt(e, e.return, $);
        }
        break;
      case 22:
      case 23:
        e.memoizedState === null && Ch(e, t);
        break;
      default:
        Ch(e, t);
    }
  }
  function Ah(e, t) {
    if (e.subtreeFlags & 67108864)
      for (e = e.child; e !== null; ) {
        e: {
          var i = e, l = t;
          switch (i.tag) {
            case 4:
              _y(i, l);
              break e;
            case 22:
              i.memoizedState === null && Ah(i, l);
              break e;
            default:
              Ah(i, l);
          }
        }
        e = e.sibling;
      }
  }
  function Ey(e) {
    var t = e.alternate;
    t !== null && (e.alternate = null, Ey(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && aa(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
  }
  var Pt = null, ki = !1;
  function Ta(e, t, i) {
    for (i = i.child; i !== null; )
      Ny(e, t, i), i = i.sibling;
  }
  function Ny(e, t, i) {
    if (en && typeof en.onCommitFiberUnmount == "function")
      try {
        en.onCommitFiberUnmount(dt, i);
      } catch {
      }
    switch (i.tag) {
      case 26:
        Ct || ni(i, t), Ta(
          e,
          t,
          i
        ), i.memoizedState ? i.memoizedState.count-- : i.stateNode && !Ct && (i = i.stateNode, i.parentNode.removeChild(i));
        break;
      case 27:
        Ct || ni(i, t), Vo(i);
        var l = Pt, c = ki;
        ns(i.type) && (Pt = i.stateNode, ki = !1), Ta(
          e,
          t,
          i
        ), Mv(
          i.stateNode,
          i.type,
          i.memoizedProps
        ), Pt = l, ki = c;
        break;
      case 5:
        Ct || ni(i, t), Vo(i);
      case 6:
        if (i.tag === 6 && Vo(i), l = Pt, c = ki, Pt = null, Ta(
          e,
          t,
          i
        ), Pt = l, ki = c, Pt !== null)
          if (ki)
            try {
              (Pt.nodeType === 9 ? Pt.body : Pt.nodeName === "HTML" ? Pt.ownerDocument.body : Pt).removeChild(i.stateNode), Ke = !0;
            } catch (u) {
              jt(
                i,
                t,
                u
              );
            }
          else
            try {
              Pt.removeChild(i.stateNode), Ke = !0;
            } catch (u) {
              jt(
                i,
                t,
                u
              );
            }
        break;
      case 18:
        Pt !== null && (ki ? (e = Pt, mv(
          e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e,
          i.stateNode
        ), Zr(e)) : mv(Pt, i.stateNode));
        break;
      case 4:
        l = Pt, c = ki, Pt = i.stateNode.containerInfo, ki = !0, Ta(
          e,
          t,
          i
        ), Pt = l, ki = c;
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        Kl(2, i, t), Ct || Kl(4, i, t), Ta(
          e,
          t,
          i
        );
        break;
      case 1:
        Ct || (ni(i, t), l = i.stateNode, typeof l.componentWillUnmount == "function" && fy(
          i,
          t,
          l
        )), Ta(
          e,
          t,
          i
        );
        break;
      case 21:
        Ta(
          e,
          t,
          i
        );
        break;
      case 22:
        Ct = (l = Ct) || i.memoizedState !== null, Ta(
          e,
          t,
          i
        ), Ct = l;
        break;
      case 30:
        ni(i, t), Ta(
          e,
          t,
          i
        );
        break;
      case 7:
        Ct || ni(i, t), Ta(
          e,
          t,
          i
        );
        break;
      default:
        Ta(
          e,
          t,
          i
        );
    }
  }
  function Ty(e, t) {
    if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
      e = e.dehydrated;
      try {
        Zr(e);
      } catch (i) {
        jt(t, t.return, i);
      }
    }
  }
  function Cy(e, t) {
    if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null))))
      try {
        Zr(e);
      } catch (i) {
        jt(t, t.return, i);
      }
  }
  function R_(e) {
    switch (e.tag) {
      case 31:
      case 13:
      case 19:
        var t = e.stateNode;
        return t === null && (t = e.stateNode = new Sy()), t;
      case 22:
        return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new Sy()), t;
      default:
        throw Error(r(435, e.tag));
    }
  }
  function Ou(e, t) {
    var i = R_(e);
    t.forEach(function(l) {
      if (!i.has(l)) {
        i.add(l);
        var c = X_.bind(null, e, l);
        l.then(c, c);
      }
    });
  }
  function xi(e, t, i) {
    var l = t.deletions;
    if (l !== null)
      for (var c = 0; c < l.length; c++) {
        var u = l[c], x = e, T = t, $ = T;
        e: for (; $ !== null; ) {
          switch ($.tag) {
            case 27:
              if (ns($.type)) {
                Pt = $.stateNode, ki = !1;
                break e;
              }
              break;
            case 5:
              Pt = $.stateNode, ki = !1;
              break e;
            case 3:
            case 4:
              Pt = $.stateNode.containerInfo, ki = !0;
              break e;
          }
          $ = $.return;
        }
        if (Pt === null) throw Error(r(160));
        Ny(x, T, u), Pt = null, ki = !1, x = u.alternate, x !== null && (x.return = null), u.return = null;
      }
    if (t.subtreeFlags & 13886)
      for (t = t.child; t !== null; )
        Ay(t, e, i), t = t.sibling;
  }
  var Ca = null;
  function Ay(e, t, i) {
    var l = e.alternate, c = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        if (c & 4 && (l = e.updateQueue, l = l !== null ? l.events : null, l !== null))
          for (var u = 0; u < l.length; u++) {
            var x = l[u];
            x.ref.impl = x.nextImpl;
          }
        xi(t, e, i), bi(e), c & 4 && (Kl(3, e, e.return), qo(3, e), Kl(5, e, e.return));
        break;
      case 1:
        xi(t, e, i), bi(e), c & 512 && (Ct || l === null || ni(l, l.return)), c & 64 && In && (e = e.updateQueue, e !== null && (t = e.callbacks, t !== null && (i = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = i === null ? t : i.concat(t))));
        break;
      case 26:
        if (u = Ca, xi(t, e, i), bi(e), c & 512 && (Ct || l === null || ni(l, l.return)), c & 4)
          if (c = l !== null ? l.memoizedState : null, i = e.memoizedState, l === null)
            if (i === null)
              if (e.stateNode === null)
                if (In)
                  e.stateNode = fv(
                    e.type,
                    e.memoizedProps,
                    t.containerInfo,
                    e
                  );
                else {
                  e: {
                    t = e.type, i = e.memoizedProps, c = u.ownerDocument || u;
                    t: switch (t) {
                      case "title":
                        l = c.getElementsByTagName("title")[0], (!l || l[Bi] || l[qt] || l.namespaceURI === "http://www.w3.org/2000/svg" || l.hasAttribute("itemprop")) && (l = c.createElement(t), c.head.insertBefore(
                          l,
                          c.querySelector("head > title")
                        )), ii(l, t, i), l[qt] = e, yt(l), t = l;
                        break e;
                      case "link":
                        if (u = Dv(
                          "link",
                          "href",
                          c
                        ).get(t + (i.href || ""))) {
                          for (x = 0; x < u.length; x++)
                            if (l = u[x], l.getAttribute("href") === (i.href == null || i.href === "" ? null : i.href) && l.getAttribute("rel") === (i.rel == null ? null : i.rel) && l.getAttribute("title") === (i.title == null ? null : i.title) && l.getAttribute("crossorigin") === (i.crossOrigin == null ? null : i.crossOrigin)) {
                              u.splice(x, 1);
                              break t;
                            }
                        }
                        l = c.createElement(t), ii(l, t, i), c.head.appendChild(l);
                        break;
                      case "meta":
                        if (u = Dv(
                          "meta",
                          "content",
                          c
                        ).get(t + (i.content || ""))) {
                          for (x = 0; x < u.length; x++)
                            if (l = u[x], l.getAttribute("content") === (i.content == null ? null : "" + i.content) && l.getAttribute("name") === (i.name == null ? null : i.name) && l.getAttribute("property") === (i.property == null ? null : i.property) && l.getAttribute("http-equiv") === (i.httpEquiv == null ? null : i.httpEquiv) && l.getAttribute("charset") === (i.charSet == null ? null : i.charSet)) {
                              u.splice(x, 1);
                              break t;
                            }
                        }
                        l = c.createElement(t), ii(l, t, i), c.head.appendChild(l);
                        break;
                      default:
                        throw Error(r(468, t));
                    }
                    l[qt] = e, yt(l), t = l;
                  }
                  e.stateNode = t;
                }
              else
                In || dm(u, e.type, e.stateNode);
            else
              e.stateNode = Ov(
                u,
                i,
                e.memoizedProps
              );
          else
            c !== i ? (c === null ? (t = l.stateNode, t === null || Ct || t.parentNode.removeChild(t)) : c.count--, i === null ? In || dm(u, e.type, e.stateNode) : Ov(u, i, e.memoizedProps)) : i === null && e.stateNode !== null && yh(
              e,
              e.memoizedProps,
              l.memoizedProps
            );
        break;
      case 27:
        xi(t, e, i), bi(e), c & 512 && (Ct || l === null || ni(l, l.return)), l !== null && c & 4 && yh(
          e,
          e.memoizedProps,
          l.memoizedProps
        );
        break;
      case 5:
        if (u = Wa, Wa = !1, xi(t, e, i), Wa = u, bi(e), c & 512 && (Ct || l === null || ni(l, l.return)), e.flags & 32) {
          t = e.stateNode;
          try {
            xe(t, ""), Ke = !0;
          } catch (fe) {
            jt(e, e.return, fe);
          }
        }
        c & 4 && e.stateNode != null && (t = e.memoizedProps, yh(
          e,
          t,
          l !== null ? l.memoizedProps : t
        )), c & 1024 && (Nh = !0);
        break;
      case 6:
        if (xi(t, e, i), bi(e), c & 4) {
          if (e.stateNode === null)
            throw Error(r(162));
          t = e.memoizedProps, i = e.stateNode;
          try {
            i.nodeValue = t, Ke = !0;
          } catch (fe) {
            jt(e, e.return, fe);
          }
        }
        break;
      case 3:
        if (Ke = !1, Ku = null, u = Ca, Ca = Fo(t.containerInfo), xi(t, e, i), Ca = u, bi(e), c & 4 && l !== null && l.memoizedState.isDehydrated)
          try {
            Zr(t.containerInfo);
          } catch (fe) {
            jt(e, e.return, fe);
          }
        Nh && (Nh = !1, My(e)), Ke = !1;
        break;
      case 4:
        c = Wa, Wa = In, l = va(), u = Ca, Ca = Fo(
          e.stateNode.containerInfo
        ), xi(t, e, i), bi(e), Ca = u, Ke && Yo && (ju = !0), Ke = l, Wa = c;
        break;
      case 12:
        xi(t, e, i), bi(e);
        break;
      case 31:
        xi(t, e, i), bi(e), c & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Ou(e, t)));
        break;
      case 13:
        xi(t, e, i), bi(e), e.child.flags & 8192 && e.memoizedState !== null != (l !== null && l.memoizedState !== null) && (Lu = Zt()), c & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Ou(e, t)));
        break;
      case 22:
        u = e.memoizedState !== null, x = l !== null && l.memoizedState !== null;
        var T = In, $ = Ct, ie = Wa;
        In = T || u, Wa = ie || u, Ct = $ || x, xi(t, e, i), Ct = $, Wa = ie, In = T, bi(e), c & 8192 && (t = e.stateNode, t._visibility = u ? t._visibility & -2 : t._visibility | 1, !u || l === null || x || In || Ct || (t = x || Ct, i = In, l = Ct, In = u || In, Ct = t, Pl(e, 2), In = i, Ct = l), !u && Wa || Ch(e, u)), c & 4 && (t = e.updateQueue, t !== null && (i = t.retryQueue, i !== null && (t.retryQueue = null, Ou(e, i))));
        break;
      case 19:
        xi(t, e, i), bi(e), c & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Ou(e, t)));
        break;
      case 30:
        c & 512 && (Ct || l === null || ni(l, l.return)), c = va(), u = Yo, x = (i & 335544064) === i, T = e.memoizedProps, Yo = x && gl(
          T.default,
          T.update
        ) !== "none", xi(t, e, i), bi(e), x && l !== null && Ke && (e.flags |= 4), Yo = u, Ke = c;
        break;
      case 21:
        break;
      case 7:
        c & 512 && (Ct || l === null || ni(l, l.return)), l && l.stateNode !== null && (l.stateNode._fragmentFiber = e);
      default:
        xi(t, e, i), bi(e);
    }
  }
  function bi(e) {
    var t = e.flags;
    if (t & 2) {
      try {
        for (var i, l = e.return; l !== null; ) {
          if (hy(l)) {
            i = l;
            break;
          }
          l = l.return;
        }
        l = null;
        for (var c = e.return; c !== null; ) {
          if (ph(c)) {
            var u = c.stateNode;
            l === null ? l = [u] : l.push(u);
          }
          if (mh(c)) break;
          c = c.return;
        }
        var x = l;
        if (i == null) throw Error(r(160));
        switch (i.tag) {
          case 27:
            var T = i.stateNode, $ = vh(e);
            Au(
              e,
              $,
              T,
              x
            );
            break;
          case 5:
            var ie = i.stateNode;
            i.flags & 32 && (xe(ie, ""), i.flags &= -33);
            var fe = vh(e);
            Au(
              e,
              fe,
              ie,
              x
            );
            break;
          case 3:
          case 4:
            var ve = i.stateNode.containerInfo, W = vh(e);
            xh(
              e,
              W,
              ve,
              x
            );
            break;
          default:
            throw Error(r(161));
        }
      } catch (ue) {
        jt(e, e.return, ue);
      }
      e.flags &= -3;
    }
    t & 4096 && (e.flags &= -4097);
  }
  function My(e) {
    if (e.subtreeFlags & 1024)
      for (e = e.child; e !== null; ) {
        var t = e;
        My(t), t.tag === 5 && t.flags & 1024 && (t = t.stateNode, Gr = !0, t.reset(), Gr = !1), e = e.sibling;
      }
  }
  function Mr(e, t) {
    if (t.subtreeFlags & 9270)
      for (t = t.child; t !== null; )
        zy(t, e), t = t.sibling;
    else by(t);
  }
  function zy(e, t) {
    var i = e.alternate;
    if (i === null) bh(e, !1);
    else
      switch (e.tag) {
        case 3:
          if (Th = el = !1, gy(), Mr(t, e), !el && !ju) {
            if (e = Ja, e !== null)
              for (var l = 0; l < e.length; l += 3) {
                i = e[l];
                var c = e[l + 1];
                yv(i, e[l + 2]), i = i.ownerDocument.documentElement, i !== null && i.animate(
                  { opacity: [0, 0], pointerEvents: ["none", "none"] },
                  {
                    duration: 0,
                    fill: "forwards",
                    pseudoElement: "::view-transition-group(" + c + ")"
                  }
                );
              }
            e = t.containerInfo, e = e.nodeType === 9 ? e.documentElement : e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "" && (e.style.viewTransitionName = "none", e.animate(
              { opacity: [0, 0], pointerEvents: ["none", "none"] },
              {
                duration: 0,
                fill: "forwards",
                pseudoElement: "::view-transition-group(root)"
              }
            ), e.animate(
              { width: [0, 0], height: [0, 0] },
              {
                duration: 0,
                fill: "forwards",
                pseudoElement: "::view-transition"
              }
            )), Th = !0;
          }
          Ja = null;
          break;
        case 5:
          Mr(t, e);
          break;
        case 4:
          l = el, el = !1, Mr(t, e), el && (ju = !0), el = l;
          break;
        case 22:
          e.memoizedState === null && (i.memoizedState !== null ? bh(e, !1) : Mr(t, e));
          break;
        case 30:
          l = el, c = gy(), el = !1, Mr(t, e), el && (e.flags |= 4);
          var u = e.memoizedProps, x = e.stateNode;
          t = pl(u, x), x = pl(i.memoizedProps, x);
          var T = gl(u.default, u.update);
          T === "none" ? t = !1 : (u = i.memoizedState, i.memoizedState = null, i = e.child, zi = 0, t = Eh(
            e,
            i,
            t,
            x,
            T,
            u,
            !0
          ), zi !== (u === null ? 0 : u.length) && (e.flags |= 32)), (e.flags & 4) !== 0 && t ? (Hr(
            e,
            e.memoizedProps.onUpdate
          ), Ja = c) : c !== null && (c.push.apply(c, Ja), Ja = c), el = (e.flags & 32) !== 0 ? !0 : l;
          break;
        default:
          Mr(t, e);
      }
  }
  function tl(e, t) {
    if (t.subtreeFlags & 8772)
      for (t = t.child; t !== null; )
        wy(e, t.alternate, t), t = t.sibling;
  }
  function Pl(e, t) {
    for (e = e.child; e !== null; ) {
      var i = e, l = t;
      switch (i.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          Kl(4, i, i.return), Pl(
            i,
            l
          );
          break;
        case 1:
          ni(i, i.return);
          var c = i.stateNode;
          typeof c.componentWillUnmount == "function" && fy(
            i,
            i.return,
            c
          ), Pl(
            i,
            l
          );
          break;
        case 27:
          (l & 2) !== 0 && Mv(
            i.stateNode,
            i.type,
            i.memoizedProps
          );
        case 5:
          ni(i, i.return), i.tag !== 5 && i.tag !== 27 || Vo(i), Pl(
            i,
            l
          );
          break;
        case 6:
          Vo(i);
          break;
        case 26:
          ni(i, i.return), c = i.stateNode, i.memoizedState !== null || c === null || Ct || c.parentNode.removeChild(c), Pl(
            i,
            l
          );
          break;
        case 22:
          i.memoizedState === null && Pl(
            i,
            l
          );
          break;
        case 30:
          ni(i, i.return), Pl(
            i,
            l
          );
          break;
        case 7:
          ni(i, i.return);
        default:
          Pl(
            i,
            l
          );
      }
      e = e.sibling;
    }
  }
  function Aa(e, t, i) {
    for (i = (t.subtreeFlags & 8772) !== 0 ? i : i & -2, t = t.child; t !== null; ) {
      var l = t.alternate, c = e, u = t, x = u.flags, T = (i & 1) !== 0;
      switch (u.tag) {
        case 0:
        case 11:
        case 15:
          Aa(
            c,
            u,
            i
          ), qo(4, u);
          break;
        case 1:
          if (Aa(
            c,
            u,
            i
          ), l = u, c = l.stateNode, typeof c.componentDidMount == "function")
            try {
              c.componentDidMount();
            } catch (fe) {
              jt(l, l.return, fe);
            }
          if (l = u, c = l.updateQueue, c !== null) {
            var $ = l.stateNode;
            try {
              var ie = c.shared.hiddenCallbacks;
              if (ie !== null)
                for (c.shared.hiddenCallbacks = null, c = 0; c < ie.length; c++)
                  Fg(ie[c], $);
            } catch (fe) {
              jt(l, l.return, fe);
            }
          }
          T && x & 64 && uy(u), Pa(u, u.return);
          break;
        case 27:
          (i & 2) !== 0 && my(u);
        case 5:
          u.tag !== 5 && u.tag !== 27 || dy(u), Aa(
            c,
            u,
            i
          ), T && l === null && x & 4 && gh(u), Pa(u, u.return);
          break;
        case 6:
          dy(u);
          break;
        case 26:
          $ = u.stateNode, u.memoizedState !== null || $ === null || In || dm(
            Fo($.ownerDocument),
            u.type,
            $
          ), Aa(
            c,
            u,
            i
          ), T && l === null && x & 4 && gh(u), Pa(u, u.return);
          break;
        case 12:
          Aa(
            c,
            u,
            i
          );
          break;
        case 31:
          Aa(
            c,
            u,
            i
          ), T && x & 4 && Ty(c, u);
          break;
        case 13:
          Aa(
            c,
            u,
            i
          ), T && x & 4 && Cy(c, u);
          break;
        case 22:
          u.memoizedState === null && Aa(
            c,
            u,
            i
          ), Pa(u, u.return);
          break;
        case 30:
          Aa(
            c,
            u,
            i
          ), Pa(u, u.return);
          break;
        case 7:
          Pa(u, u.return);
        default:
          Aa(
            c,
            u,
            i
          );
      }
      t = t.sibling;
    }
  }
  function Mh(e, t) {
    var i = null;
    e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (i = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== i && (e != null && e.refCount++, i != null && Ao(i));
  }
  function zh(e, t) {
    e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && Ao(e));
  }
  function da(e, t, i, l) {
    var c = (i & 335544064) === i;
    if (t.subtreeFlags & (c ? 10262 : 10256))
      for (t = t.child; t !== null; )
        ky(
          e,
          t,
          i,
          l
        ), t = t.sibling;
    else c && xy(t);
  }
  function ky(e, t, i, l) {
    var c = (i & 335544064) === i;
    c && t.alternate === null && t.return !== null && t.return.alternate !== null && ku(t);
    var u = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        da(
          e,
          t,
          i,
          l
        ), u & 2048 && qo(9, t);
        break;
      case 1:
        da(
          e,
          t,
          i,
          l
        );
        break;
      case 3:
        da(
          e,
          t,
          i,
          l
        ), c && Th && (e = e.containerInfo, e = e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, e.style.viewTransitionName === "root" && (e.style.viewTransitionName = ""), e = e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "none" && (e.style.viewTransitionName = "")), u & 2048 && (u = null, t.alternate !== null && (u = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== u && (t.refCount++, u != null && Ao(u)));
        break;
      case 12:
        if (u & 2048) {
          da(
            e,
            t,
            i,
            l
          ), u = t.stateNode;
          try {
            var x = t.memoizedProps, T = x.id, $ = x.onPostCommit;
            typeof $ == "function" && $(
              T,
              t.alternate === null ? "mount" : "update",
              u.passiveEffectDuration,
              -0
            );
          } catch (ie) {
            jt(t, t.return, ie);
          }
        } else
          da(
            e,
            t,
            i,
            l
          );
        break;
      case 31:
        da(
          e,
          t,
          i,
          l
        );
        break;
      case 13:
        da(
          e,
          t,
          i,
          l
        );
        break;
      case 23:
        break;
      case 22:
        x = t.stateNode, T = t.alternate, t.memoizedState !== null ? (c && T !== null && T.memoizedState === null && ku(T), x._visibility & 2 ? da(
          e,
          t,
          i,
          l
        ) : Io(
          e,
          t
        )) : (c && T !== null && T.memoizedState !== null && ku(t), x._visibility & 2 ? da(
          e,
          t,
          i,
          l
        ) : (x._visibility |= 2, zr(
          e,
          t,
          i,
          l,
          (t.subtreeFlags & 10256) !== 0 || !1
        ))), u & 2048 && Mh(T, t);
        break;
      case 24:
        da(
          e,
          t,
          i,
          l
        ), u & 2048 && zh(t.alternate, t);
        break;
      case 30:
        c && (u = t.alternate, u !== null && (Fa(u.child, !0), Fa(t.child, !0))), da(
          e,
          t,
          i,
          l
        );
        break;
      default:
        da(
          e,
          t,
          i,
          l
        );
    }
  }
  function zr(e, t, i, l, c) {
    for (c = c && ((t.subtreeFlags & 10256) !== 0 || !1), t = t.child; t !== null; ) {
      var u = e, x = t, T = i, $ = l, ie = x.flags;
      switch (x.tag) {
        case 0:
        case 11:
        case 15:
          zr(
            u,
            x,
            T,
            $,
            c
          ), qo(8, x);
          break;
        case 23:
          break;
        case 22:
          var fe = x.stateNode;
          x.memoizedState !== null ? fe._visibility & 2 ? zr(
            u,
            x,
            T,
            $,
            c
          ) : Io(
            u,
            x
          ) : (fe._visibility |= 2, zr(
            u,
            x,
            T,
            $,
            c
          )), c && ie & 2048 && Mh(
            x.alternate,
            x
          );
          break;
        case 24:
          zr(
            u,
            x,
            T,
            $,
            c
          ), c && ie & 2048 && zh(x.alternate, x);
          break;
        default:
          zr(
            u,
            x,
            T,
            $,
            c
          );
      }
      t = t.sibling;
    }
  }
  function Io(e, t) {
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; ) {
        var i = e, l = t, c = l.flags;
        switch (l.tag) {
          case 22:
            Io(i, l), c & 2048 && Mh(
              l.alternate,
              l
            );
            break;
          case 24:
            Io(i, l), c & 2048 && zh(l.alternate, l);
            break;
          default:
            Io(i, l);
        }
        t = t.sibling;
      }
  }
  var Ls = 8192;
  function Us(e, t, i) {
    if (e.subtreeFlags & Ls)
      for (e = e.child; e !== null; )
        jy(
          e,
          t,
          i
        ), e = e.sibling;
  }
  function jy(e, t, i) {
    switch (e.tag) {
      case 26:
        Us(
          e,
          t,
          i
        ), e.flags & Ls && (e.memoizedState !== null ? B2(
          i,
          Ca,
          e.memoizedState,
          e.memoizedProps
        ) : (e = e.stateNode, (t & 335544128) === t && Bv(i, e)));
        break;
      case 5:
        Us(
          e,
          t,
          i
        ), e.flags & Ls && (e = e.stateNode, (t & 335544128) === t && Bv(i, e));
        break;
      case 3:
      case 4:
        var l = Ca;
        Ca = Fo(e.stateNode.containerInfo), Us(
          e,
          t,
          i
        ), Ca = l;
        break;
      case 22:
        e.memoizedState === null && (l = e.alternate, l !== null && l.memoizedState !== null ? (l = Ls, Ls = 16777216, Us(
          e,
          t,
          i
        ), Ls = l) : Us(
          e,
          t,
          i
        ));
        break;
      case 30:
        if ((e.flags & Ls) !== 0 && (l = e.memoizedProps.name, l != null && l !== "auto")) {
          var c = e.stateNode;
          c.paired = null, Xi === null && (Xi = /* @__PURE__ */ new Map()), Xi.set(l, c);
        }
        Us(
          e,
          t,
          i
        );
        break;
      default:
        Us(
          e,
          t,
          i
        );
    }
  }
  function Ry(e) {
    var t = e.alternate;
    if (t !== null && (e = t.child, e !== null)) {
      t.child = null;
      do
        t = e.sibling, e.sibling = null, e = t;
      while (e !== null);
    }
  }
  function Xo(e) {
    var t = e.deletions;
    if ((e.flags & 16) !== 0) {
      if (t !== null)
        for (var i = 0; i < t.length; i++) {
          var l = t[i];
          Xn = l, Dy(
            l,
            e
          );
        }
      Ry(e);
    }
    if (e.subtreeFlags & 10256)
      for (e = e.child; e !== null; )
        Oy(e), e = e.sibling;
  }
  function Oy(e) {
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        Xo(e), e.flags & 2048 && Kl(9, e, e.return);
        break;
      case 3:
        Xo(e);
        break;
      case 12:
        Xo(e);
        break;
      case 22:
        var t = e.stateNode;
        e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, Du(e)) : Xo(e);
        break;
      default:
        Xo(e);
    }
  }
  function Du(e) {
    var t = e.deletions;
    if ((e.flags & 16) !== 0) {
      if (t !== null)
        for (var i = 0; i < t.length; i++) {
          var l = t[i];
          Xn = l, Dy(
            l,
            e
          );
        }
      Ry(e);
    }
    for (e = e.child; e !== null; ) {
      switch (t = e, t.tag) {
        case 0:
        case 11:
        case 15:
          Kl(8, t, t.return), Du(t);
          break;
        case 22:
          i = t.stateNode, i._visibility & 2 && (i._visibility &= -3, Du(t));
          break;
        default:
          Du(t);
      }
      e = e.sibling;
    }
  }
  function Dy(e, t) {
    for (; Xn !== null; ) {
      var i = Xn;
      switch (i.tag) {
        case 0:
        case 11:
        case 15:
          Kl(8, i, t);
          break;
        case 23:
        case 22:
          if (i.memoizedState !== null && i.memoizedState.cachePool !== null) {
            var l = i.memoizedState.cachePool.pool;
            l != null && l.refCount++;
          }
          break;
        case 24:
          Ao(i.memoizedState.cache);
      }
      if (l = i.child, l !== null) l.return = i, Xn = l;
      else
        e: for (i = e; Xn !== null; ) {
          l = Xn;
          var c = l.sibling, u = l.return;
          if (Ey(l), l === i) {
            Xn = null;
            break e;
          }
          if (c !== null) {
            c.return = u, Xn = c;
            break e;
          }
          Xn = u;
        }
    }
  }
  var O_ = {
    getCacheForType: function(e) {
      var t = Wn(_n), i = t.data.get(e);
      return i === void 0 && (i = e(), t.data.set(e, i)), i;
    },
    cacheSignal: function() {
      return Wn(_n).controller.signal;
    }
  }, D_ = typeof WeakMap == "function" ? WeakMap : Map, wt = 0, Ut = null, lt = null, ct = 0, kt = 0, Gi = null, Jl = !1, kr = !1, kh = !1, Nl = 0, un = 0, Fl = 0, Bs = 0, Hu = 0, Zi = 0, jr = 0, Go = null, ji = null, jh = !1, Lu = 0, Hy = 0, Uu = 1 / 0, Bu = null, Wl = null, an = 0, Ma = null, $s = null, nl = 0, Rh = 0, Oh = null, Ly = null, Rr = null, Or = null, Dr = null, Zo = 0, $u = null;
  function Qi() {
    return (wt & 2) !== 0 && ct !== 0 ? ct & -ct : we.T !== null ? Ih() : kn();
  }
  function Uy() {
    if (Zi === 0)
      if ((ct & 536870912) === 0 || nt) {
        var e = Ye;
        Ye <<= 1, (Ye & 3932160) === 0 && (Ye = 262144), Zi = e;
      } else Zi = 536870912;
    return e = ei.current, e !== null && (e.flags |= 32), Zi;
  }
  function Hr(e, t) {
    if (t != null) {
      var i = e.stateNode, l = i.ref;
      l === null && (l = i.ref = vv(
        pl(e.memoizedProps, i)
      )), Or === null && (Or = []), Or.push(t.bind(null, l));
    }
  }
  function Ri(e, t, i) {
    (e === Ut && (kt === 2 || kt === 9) || e.cancelPendingCommit !== null) && (Lr(e, 0), es(
      e,
      ct,
      Zi,
      !1
    )), nn(e, i), ((wt & 2) === 0 || e !== Ut) && (e === Ut && ((wt & 2) === 0 && (Bs |= i), un === 4 && es(
      e,
      ct,
      Zi,
      !1
    )), il(e));
  }
  function By(e, t, i) {
    if ((wt & 6) !== 0) throw Error(r(327));
    var l = !i && (t & 127) === 0 && (t & e.expiredLanes) === 0 || Qt(e, t), c = l ? U_(e, t) : Hh(e, t, !0), u = l;
    do {
      if (c === 0) {
        kr && !l && es(e, t, 0, !1);
        break;
      } else {
        if (i = e.current.alternate, u && !H_(i)) {
          c = Hh(e, t, !1), u = !1;
          continue;
        }
        if (c === 2) {
          if (u = t, e.errorRecoveryDisabledLanes & u)
            var x = 0;
          else
            x = e.pendingLanes & -536870913, x = x !== 0 ? x : x & 536870912 ? 536870912 : 0;
          if (x !== 0) {
            t = x;
            e: {
              var T = e;
              c = Go;
              var $ = T.current.memoizedState.isDehydrated;
              if ($ && (Lr(T, x).flags |= 256), x = Hh(
                T,
                x,
                !1
              ), x !== 2 && x !== 6) {
                if (kh && !$) {
                  T.errorRecoveryDisabledLanes |= u, Bs |= u, c = 4;
                  break e;
                }
                u = ji, ji = c, u !== null && (ji === null ? ji = u : ji.push.apply(
                  ji,
                  u
                ));
              }
              c = x;
            }
            if (u = !1, c !== 2) continue;
          }
        }
        if (c === 1) {
          Lr(e, 0), es(e, t, 0, !0);
          break;
        }
        e: {
          switch (l = e, u = c, u) {
            case 0:
            case 1:
              throw Error(r(345));
            case 4:
              if ((t & 4194048) !== t && (t & 62914560) !== t)
                break;
            case 6:
              es(
                l,
                t,
                Zi,
                !Jl
              );
              break e;
            case 2:
              ji = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(r(329));
          }
          if ((t & 62914560) === t && (c = Lu + 300 - Zt(), 10 < c)) {
            if (es(
              l,
              t,
              Zi,
              !Jl
            ), Kn(l, 0, !0) !== 0) break e;
            nl = t, l.timeoutHandle = tm(
              $y.bind(
                null,
                l,
                i,
                ji,
                Bu,
                jh,
                t,
                Zi,
                Bs,
                jr,
                Jl,
                u,
                "Throttled",
                -0,
                0
              ),
              c
            );
            break e;
          }
          $y(
            l,
            i,
            ji,
            Bu,
            jh,
            t,
            Zi,
            Bs,
            jr,
            Jl,
            u,
            null,
            -0,
            0
          );
        }
      }
      break;
    } while (!0);
    il(e);
  }
  function $y(e, t, i, l, c, u, x, T, $, ie, fe, ve, W, ue) {
    e.timeoutHandle = -1;
    var Ae = t.subtreeFlags, Oe = (u & 335544064) === u;
    if (ve = null, (Oe || Ae & 8192 || (Ae & 16785408) === 16785408) && (ve = {
      stylesheets: null,
      count: 0,
      imgCount: 0,
      imgBytes: 0,
      suspenseyImages: [],
      waitingForImages: !0,
      waitingForViewTransition: !1,
      unsuspend: vt
    }, Xi = null, jy(
      t,
      u,
      ve
    ), Oe && (Ae = ve, Oe = e.containerInfo, Oe = (Oe.nodeType === 9 ? Oe : Oe.ownerDocument).__reactViewTransition, Oe != null && (Ae.count++, Ae.waitingForViewTransition = !0, Ae = tc.bind(Ae), Oe.finished.then(Ae, Ae))), Ae = (u & 62914560) === u ? Lu - Zt() : (u & 4194048) === u ? Hy - Zt() : 0, Ae = $2(
      ve,
      Ae
    ), Ae !== null)) {
      nl = u, e.cancelPendingCommit = Ae(
        Qy.bind(
          null,
          e,
          t,
          u,
          i,
          l,
          c,
          x,
          T,
          $,
          ie,
          fe,
          ve,
          null,
          W,
          ue
        )
      ), es(e, u, x, !ie);
      return;
    }
    Qy(
      e,
      t,
      u,
      i,
      l,
      c,
      x,
      T,
      $,
      ie,
      fe,
      ve
    );
  }
  function H_(e) {
    for (var t = e; ; ) {
      var i = t.tag;
      if ((i === 0 || i === 11 || i === 15) && t.flags & 16384 && (i = t.updateQueue, i !== null && (i = i.stores, i !== null)))
        for (var l = 0; l < i.length; l++) {
          var c = i[l], u = c.getSnapshot;
          c = c.value;
          try {
            if (!Yi(u(), c)) return !1;
          } catch {
            return !1;
          }
        }
      if (i = t.child, t.subtreeFlags & 16384 && i !== null)
        i.return = t, t = i;
      else {
        if (t === e) break;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === e) return !0;
          t = t.return;
        }
        t.sibling.return = t.return, t = t.sibling;
      }
    }
    return !0;
  }
  function es(e, t, i, l) {
    t = tn(e, t), t &= ~Hu, t &= ~Bs, e.suspendedLanes |= t, e.pingedLanes &= ~t, l && (e.warmLanes |= t), l = e.expirationTimes;
    for (var c = t; 0 < c; ) {
      var u = 31 - Mt(c), x = 1 << u;
      l[u] = -1, c &= ~x;
    }
    i !== 0 && gi(e, i, t);
  }
  function qu() {
    return (wt & 6) === 0 ? (Qo(0), !1) : !0;
  }
  function Dh() {
    if (lt !== null) {
      if (kt === 0)
        var e = lt.return;
      else
        e = lt, xl = Cs = null, Yd(e), _r = null, ko = 0, e = lt;
      for (; e !== null; )
        cy(e.alternate, e), e = e.return;
      lt = null;
    }
  }
  function Lr(e, t) {
    var i = e.timeoutHandle;
    return i !== -1 && (e.timeoutHandle = -1, s2(i)), i = e.cancelPendingCommit, i !== null && (e.cancelPendingCommit = null, i()), nl = 0, Dh(), Ut = e, lt = i = yl(e.current, null), ct = t, kt = 0, Gi = null, Jl = !1, kr = Qt(e, t), kh = !1, jr = Zi = Hu = Bs = Fl = un = 0, ji = Go = null, jh = !1, Nl = tn(e, t), Kc(), i;
  }
  function qy(e, t) {
    We = null, we.H = bu, t === wr || t === su ? (t = Qg(), kt = 3) : t === zd ? (t = Qg(), kt = 4) : kt = t === ah ? 8 : t !== null && typeof t == "object" && typeof t.then == "function" ? 6 : 1, Gi = t, lt === null && (un = 1, Su(
      e,
      oa(t, e.current)
    ));
  }
  function Vy() {
    var e = ei.current;
    return e === null ? !0 : (ct & 4194048) === ct ? mi === null : (ct & 62914560) === ct || (ct & 536870912) !== 0 ? e === mi : !1;
  }
  function Yy() {
    var e = we.H;
    return we.H = bu, e === null ? bu : e;
  }
  function Iy() {
    var e = we.A;
    return we.A = O_, e;
  }
  function Vu() {
    un = 4, Jl || (ct & 4194048) !== ct && ei.current !== null || (kr = !0), (Fl & 134217727) === 0 && (Bs & 134217727) === 0 || Ut === null || es(
      Ut,
      ct,
      Zi,
      !1
    );
  }
  function Hh(e, t, i) {
    var l = wt;
    wt |= 2;
    var c = Yy(), u = Iy();
    (Ut !== e || ct !== t) && (Bu = null, Lr(e, t)), t = !1;
    var x = un;
    e: do
      try {
        if (kt !== 0 && lt !== null) {
          var T = lt, $ = Gi;
          switch (kt) {
            case 8:
              Dh(), x = 6;
              break e;
            case 3:
            case 2:
            case 9:
            case 6:
              ei.current === null && (t = !0);
              var ie = kt;
              if (kt = 0, Gi = null, Ur(e, T, $, ie), i && kr) {
                x = 0;
                break e;
              }
              break;
            default:
              ie = kt, kt = 0, Gi = null, Ur(e, T, $, ie);
          }
        }
        L_(), x = un;
        break;
      } catch (fe) {
        qy(e, fe);
      }
    while (!0);
    return t && e.shellSuspendCounter++, xl = Cs = null, wt = l, we.H = c, we.A = u, lt === null && (Ut = null, ct = 0, Kc()), x;
  }
  function L_() {
    for (; lt !== null; ) Xy(lt);
  }
  function U_(e, t) {
    var i = wt;
    wt |= 2;
    var l = Yy(), c = Iy();
    Ut !== e || ct !== t ? (Bu = null, Uu = Zt() + 500, Lr(e, t)) : kr = Qt(
      e,
      t
    );
    e: do
      try {
        if (kt !== 0 && lt !== null) {
          t = lt;
          var u = Gi;
          t: switch (kt) {
            case 1:
              kt = 0, Gi = null, Ur(e, t, u, 1);
              break;
            case 2:
            case 9:
              if (Gg(u)) {
                kt = 0, Gi = null, Gy(t);
                break;
              }
              t = function() {
                kt !== 2 && kt !== 9 || Ut !== e || (kt = 7), il(e);
              }, u.then(t, t);
              break e;
            case 3:
              kt = 7;
              break e;
            case 4:
              kt = 5;
              break e;
            case 7:
              Gg(u) ? (kt = 0, Gi = null, Gy(t)) : (kt = 0, Gi = null, Ur(e, t, u, 7));
              break;
            case 5:
              var x = null;
              switch (lt.tag) {
                case 26:
                  x = lt.memoizedState;
                case 5:
                case 27:
                  var T = lt;
                  if (x ? Lv(x) : T.stateNode.complete) {
                    kt = 0, Gi = null;
                    var $ = T.sibling;
                    if ($ !== null) lt = $;
                    else {
                      var ie = T.return;
                      ie !== null ? (lt = ie, Yu(ie)) : lt = null;
                    }
                    break t;
                  }
              }
              kt = 0, Gi = null, Ur(e, t, u, 5);
              break;
            case 6:
              kt = 0, Gi = null, Ur(e, t, u, 6);
              break;
            case 8:
              Dh(), un = 6;
              break e;
            default:
              throw Error(r(462));
          }
        }
        B_();
        break;
      } catch (fe) {
        qy(e, fe);
      }
    while (!0);
    return xl = Cs = null, we.H = l, we.A = c, wt = i, lt !== null ? 0 : (Ut = null, ct = 0, Kc(), un);
  }
  function B_() {
    for (; lt !== null && !Wt(); )
      Xy(lt);
  }
  function Xy(e) {
    var t = ry(e.alternate, e, Nl);
    e.memoizedProps = e.pendingProps, t === null ? Yu(e) : lt = t;
  }
  function Gy(e) {
    var t = e, i = t.alternate;
    switch (t.tag) {
      case 15:
      case 0:
        t = ey(
          i,
          t,
          t.pendingProps,
          t.type,
          void 0,
          ct
        );
        break;
      case 11:
        t = ey(
          i,
          t,
          t.pendingProps,
          t.type.render,
          t.ref,
          ct
        );
        break;
      case 5:
        Yd(t);
        var l = t;
        l === Yn && (nt ? (tu(l), l.tag === 5 && l.stateNode != null && (Vt = l.stateNode)) : (tu(l), nt = !0));
      default:
        cy(i, t), t = lt = Dg(t, Nl), t = ry(i, t, Nl);
    }
    e.memoizedProps = e.pendingProps, t === null ? Yu(e) : lt = t;
  }
  function Ur(e, t, i, l) {
    xl = Cs = null, Yd(t), _r = null, ko = 0;
    var c = t.return;
    try {
      if (T_(
        e,
        c,
        t,
        i,
        ct
      )) {
        un = 1, Su(
          e,
          oa(i, e.current)
        ), lt = null;
        return;
      }
    } catch (u) {
      if (c !== null) throw lt = c, u;
      un = 1, Su(
        e,
        oa(i, e.current)
      ), lt = null;
      return;
    }
    t.flags & 32768 ? (nt || l === 1 ? e = !0 : kr || (ct & 536870912) !== 0 ? e = !1 : (Jl = e = !0, (l === 2 || l === 9 || l === 3 || l === 6) && (l = ei.current, l !== null && l.tag === 13 && (l.flags |= 16384))), Zy(t, e)) : Yu(t);
  }
  function Yu(e) {
    var t = e;
    do {
      if ((t.flags & 32768) !== 0) {
        Zy(
          t,
          Jl
        );
        return;
      }
      e = t.return;
      var i = z_(
        t.alternate,
        t,
        Nl
      );
      if (i !== null) {
        lt = i;
        return;
      }
      if (t = t.sibling, t !== null) {
        lt = t;
        return;
      }
      lt = t = e;
    } while (t !== null);
    un === 0 && (un = 5);
  }
  function Zy(e, t) {
    do {
      var i = k_(e.alternate, e);
      if (i !== null) {
        i.flags &= 32767, lt = i;
        return;
      }
      if (i = e.return, i !== null && (i.flags |= 32768, i.subtreeFlags = 0, i.deletions = null), !t && (e = e.sibling, e !== null)) {
        lt = e;
        return;
      }
      lt = e = i;
    } while (e !== null);
    un = 6, lt = null;
  }
  function Qy(e, t, i, l, c, u, x, T, $, ie, fe, ve) {
    e.cancelPendingCommit = null;
    do
      Iu();
    while (an !== 0);
    if ((wt & 6) !== 0) throw Error(r(327));
    if (t !== null) {
      if (t === e.current) throw Error(r(177));
      e === Ut && (lt = Ut = null, ct = 0), $s = t, Ma = e, nl = i, Oh = c, Ly = l, $_(
        e,
        t,
        i,
        x,
        T,
        $,
        ve
      );
    }
  }
  function $_(e, t, i, l, c, u, x) {
    var T = t.lanes | t.childLanes;
    if (Rh = T, T |= yd, Ot(
      e,
      i,
      T,
      l,
      c,
      u
    ), Or = null, (i & 335544064) === i ? (Dr = m_(e), l = 10262) : (Dr = null, l = 10256), (t.subtreeFlags & l) !== 0 || (t.flags & l) !== 0 ? (e.callbackNode = null, e.callbackPriority = 0, G_(Lt, function() {
      return $h(), null;
    })) : (e.callbackNode = null, e.callbackPriority = 0), Mu = !1, l = (t.flags & 13878) !== 0, (t.subtreeFlags & 13878) !== 0 || l) {
      l = we.T, we.T = null, c = Ne.p, Ne.p = 2, u = wt, wt |= 4;
      try {
        j_(e, t, i);
      } finally {
        wt = u, Ne.p = c, we.T = l;
      }
    }
    an = 1, Mu ? Rr = d2(
      x,
      e.containerInfo,
      Dr,
      Lh,
      Uh,
      V_,
      Bh,
      $h,
      q_
    ) : (Lh(), Uh(), Bh());
  }
  function q_(e) {
    if (an !== 0) {
      var t = Ma.onRecoverableError;
      t(e, { componentStack: null });
    }
  }
  function V_() {
    an === 3 && (an = 0, zy($s, Ma), an = 4);
  }
  function Lh() {
    if (an === 1) {
      an = 0;
      var e = Ma, t = $s, i = nl, l = (t.flags & 13878) !== 0;
      if ((t.subtreeFlags & 13878) !== 0 || l) {
        l = we.T, we.T = null;
        var c = Ne.p;
        Ne.p = 2;
        var u = wt;
        wt |= 4;
        try {
          Yo = ju = !1, Ay(t, e, i), i = Fh;
          var x = Ng(e.containerInfo), T = i.focusedElem, $ = i.selectionRange;
          if (x !== T && T && T.ownerDocument && Eg(
            T.ownerDocument.documentElement,
            T
          )) {
            if ($ !== null && dd(T)) {
              var ie = $.start, fe = $.end;
              if (fe === void 0 && (fe = ie), "selectionStart" in T)
                T.selectionStart = ie, T.selectionEnd = Math.min(
                  fe,
                  T.value.length
                );
              else {
                var ve = T.ownerDocument || document, W = ve && ve.defaultView || window;
                if (W.getSelection) {
                  var ue = W.getSelection(), Ae = T.textContent.length, Oe = Math.min($.start, Ae), et = $.end === void 0 ? Oe : Math.min($.end, Ae);
                  !ue.extend && Oe > et && (x = et, et = Oe, Oe = x);
                  var ne = _g(
                    T,
                    Oe
                  ), Z = _g(
                    T,
                    et
                  );
                  if (ne && Z && (ue.rangeCount !== 1 || ue.anchorNode !== ne.node || ue.anchorOffset !== ne.offset || ue.focusNode !== Z.node || ue.focusOffset !== Z.offset)) {
                    var se = ve.createRange();
                    se.setStart(ne.node, ne.offset), ue.removeAllRanges(), Oe > et ? (ue.addRange(se), ue.extend(Z.node, Z.offset)) : (se.setEnd(Z.node, Z.offset), ue.addRange(se));
                  }
                }
              }
            }
            for (ve = [], ue = T; ue = ue.parentNode; )
              ue.nodeType === 1 && ve.push({
                element: ue,
                left: ue.scrollLeft,
                top: ue.scrollTop
              });
            for (typeof T.focus == "function" && T.focus(), T = 0; T < ve.length; T++) {
              var ge = ve[T];
              ge.element.scrollLeft = ge.left, ge.element.scrollTop = ge.top;
            }
          }
          Gr = !!Jh, Fh = Jh = null;
        } finally {
          wt = u, Ne.p = c, we.T = l;
        }
      }
      e.current = t, an = 2;
    }
  }
  function Uh() {
    if (an === 2) {
      an = 0;
      var e = Ma, t = $s, i = (t.flags & 8772) !== 0;
      if ((t.subtreeFlags & 8772) !== 0 || i) {
        i = we.T, we.T = null;
        var l = Ne.p;
        Ne.p = 2;
        var c = wt;
        wt |= 4;
        try {
          wy(e, t.alternate, t);
        } finally {
          wt = c, Ne.p = l, we.T = i;
        }
      }
      an = 3;
    }
  }
  function Bh() {
    if (an === 4 || an === 3) {
      an = 0;
      var e = Rr;
      Rr = null, Li();
      var t = Ma, i = $s, l = nl, c = Ly, u = (l & 335544064) === l ? 10262 : 10256;
      if ((i.subtreeFlags & u) !== 0 || (i.flags & u) !== 0 ? an = 5 : (an = 0, $s = Ma = null, Ky(t, t.pendingLanes)), u = t.pendingLanes, u === 0 && (Wl = null), ht(l), i = i.stateNode, en && typeof en.onCommitFiberRoot == "function")
        try {
          en.onCommitFiberRoot(
            dt,
            i,
            void 0,
            (i.current.flags & 128) === 128
          );
        } catch {
        }
      if (c !== null) {
        i = we.T, u = Ne.p, Ne.p = 2, we.T = null;
        try {
          for (var x = t.onRecoverableError, T = 0; T < c.length; T++) {
            var $ = c[T];
            x($.value, {
              componentStack: $.stack
            });
          }
        } finally {
          we.T = i, Ne.p = u;
        }
      }
      if (c = Or, x = Dr, Dr = null, c !== null && (Or = null, x === null && (x = []), e !== null))
        for ($ = 0; $ < c.length; $++)
          i = (0, c[$])(
            x
          ), i !== void 0 && e.finished.finally(i);
      (nl & 3) !== 0 && Iu(), il(t), u = t.pendingLanes, (l & 261930) !== 0 && (u & 42) !== 0 ? t === $u ? Zo++ : (Zo = 0, $u = t) : (Zo = 0, $u = null), Qo(0);
    }
  }
  function Ky(e, t) {
    (e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, Ao(t)));
  }
  function Iu() {
    return Rr !== null && (Rr.skipTransition(), Rr = null), Lh(), Uh(), Bh(), $h();
  }
  function $h() {
    if (an !== 5) return !1;
    var e = Ma, t = Rh;
    Rh = 0;
    var i = ht(nl), l = we.T, c = Ne.p;
    try {
      Ne.p = 32 > i ? 32 : i, we.T = null, i = Oh, Oh = null;
      var u = Ma, x = nl;
      if (an = 0, $s = Ma = null, nl = 0, (wt & 6) !== 0) throw Error(r(331));
      var T = wt;
      if (wt |= 4, Oy(u.current), ky(
        u,
        u.current,
        x,
        i
      ), wt = T, Qo(0, !1), en && typeof en.onPostCommitFiberRoot == "function")
        try {
          en.onPostCommitFiberRoot(dt, u);
        } catch {
        }
      return !0;
    } finally {
      Ne.p = c, we.T = l, Ky(e, t);
    }
  }
  function Py(e, t, i) {
    t = oa(i, t), t = ih(e.stateNode, t, 2), e = Xl(e, t, 2), e !== null && (nn(e, 2), il(e));
  }
  function jt(e, t, i) {
    if (e.tag === 3)
      Py(e, e, i);
    else
      for (; t !== null; ) {
        if (t.tag === 3) {
          Py(
            t,
            e,
            i
          );
          break;
        } else if (t.tag === 1) {
          var l = t.stateNode;
          if (typeof t.type.getDerivedStateFromError == "function" || typeof l.componentDidCatch == "function" && (Wl === null || !Wl.has(l))) {
            e = oa(i, e), i = G0(2), l = Xl(t, i, 2), l !== null && (Z0(
              i,
              l,
              t,
              e
            ), nn(l, 2), il(l));
            break;
          }
        }
        t = t.return;
      }
  }
  function qh(e, t, i) {
    var l = e.pingCache;
    if (l === null) {
      l = e.pingCache = new D_();
      var c = /* @__PURE__ */ new Set();
      l.set(t, c);
    } else
      c = l.get(t), c === void 0 && (c = /* @__PURE__ */ new Set(), l.set(t, c));
    c.has(i) || (kh = !0, c.add(i), e = Y_.bind(null, e, t, i), t.then(e, e));
  }
  function Y_(e, t, i) {
    var l = e.pingCache;
    l !== null && l.delete(t), e.pingedLanes |= e.suspendedLanes & i, e.warmLanes &= ~i, Ut === e && (ct & i) === i && ((un === 4 || un === 3 && (ct & 62914560) === ct && 300 > Zt() - Lu) && (wt & 2) === 0 ? Lr(e, 0) : Hu |= i, jr === ct && (jr = 0)), il(e);
  }
  function Jy(e, t) {
    t === 0 && (t = Ln()), e = Es(e, t), e !== null && (nn(e, t), il(e));
  }
  function I_(e) {
    var t = e.memoizedState, i = 0;
    t !== null && (i = t.retryLane), Jy(e, i);
  }
  function X_(e, t) {
    var i = 0;
    switch (e.tag) {
      case 31:
      case 13:
        var l = e.stateNode, c = e.memoizedState;
        c !== null && (i = c.retryLane);
        break;
      case 19:
        l = e.stateNode;
        break;
      case 22:
        l = e.stateNode._retryCache;
        break;
      default:
        throw Error(r(314));
    }
    l !== null && l.delete(t), Jy(e, i);
  }
  function G_(e, t) {
    return Gt(e, t);
  }
  var Br = null, $r = null, Vh = !1, Xu = !1, Yh = !1, ts = 0;
  function il(e) {
    e !== $r && e.next === null && ($r === null ? Br = $r = e : $r = $r.next = e), Xu = !0, Vh || (Vh = !0, Q_());
  }
  function Qo(e, t) {
    if (!Yh && Xu) {
      Yh = !0;
      do
        for (var i = !1, l = Br; l !== null; ) {
          if (e !== 0) {
            var c = l.pendingLanes;
            if (c === 0) var u = 0;
            else {
              var x = l.suspendedLanes, T = l.pingedLanes;
              u = (1 << 31 - Mt(42 | e) + 1) - 1, u &= c & ~(x & ~T), u = u & 201326741 ? u & 201326741 | 1 : u ? u | 2 : 0;
            }
            u !== 0 && (i = !0, tv(l, u));
          } else
            u = ct, u = Kn(
              l,
              l === Ut ? u : 0,
              l.cancelPendingCommit !== null || l.timeoutHandle !== -1
            ), (u & 3) === 0 || Qt(l, u) || (i = !0, tv(l, u));
          l = l.next;
        }
      while (i);
      Yh = !1;
    }
  }
  function Z_() {
    Fy();
  }
  function Fy() {
    Xu = Vh = !1;
    var e = 0;
    ts !== 0 && l2() && (e = ts);
    for (var t = Zt(), i = null, l = Br; l !== null; ) {
      var c = l.next, u = Wy(l, t);
      u === 0 ? (l.next = null, i === null ? Br = c : i.next = c, c === null && ($r = i)) : (i = l, (e !== 0 || (u & 3) !== 0) && (Xu = !0)), l = c;
    }
    an !== 0 && an !== 5 || Qo(e), ts !== 0 && (ts = 0);
  }
  function Wy(e, t) {
    for (var i = e.suspendedLanes, l = e.pingedLanes, c = e.expirationTimes, u = e.pendingLanes & -62914561; 0 < u; ) {
      var x = 31 - Mt(u), T = 1 << x, $ = c[x];
      $ === -1 ? ((T & i) === 0 || (T & l) !== 0) && (c[x] = dl(T, t)) : $ <= t && (e.expiredLanes |= T), u &= ~T;
    }
    if (t = Ut, i = ct, i = Kn(
      e,
      e === t ? i : 0,
      e.cancelPendingCommit !== null || e.timeoutHandle !== -1
    ), l = e.callbackNode, i === 0 || e === t && (kt === 2 || kt === 9) || e.cancelPendingCommit !== null)
      return l !== null && l !== null && yn(l), e.callbackNode = null, e.callbackPriority = 0;
    if ((i & 3) === 0 || Qt(e, i)) {
      if (t = i & -i, t === e.callbackPriority) return t;
      switch (l !== null && yn(l), ht(i)) {
        case 2:
        case 8:
          i = dn;
          break;
        case 32:
          i = Lt;
          break;
        case 268435456:
          i = Fe;
          break;
        default:
          i = Lt;
      }
      return l = ev.bind(null, e), i = Gt(i, l), e.callbackPriority = t, e.callbackNode = i, t;
    }
    return l !== null && l !== null && yn(l), e.callbackPriority = 2, e.callbackNode = null, 2;
  }
  function ev(e, t) {
    if (an !== 0 && an !== 5)
      return e.callbackNode = null, e.callbackPriority = 0, null;
    var i = e.callbackNode;
    if (Iu() && e.callbackNode !== i)
      return null;
    var l = ct;
    return l = Kn(
      e,
      e === Ut ? l : 0,
      e.cancelPendingCommit !== null || e.timeoutHandle !== -1
    ), l === 0 ? null : (By(e, l, t), Wy(e, Zt()), e.callbackNode != null && e.callbackNode === i ? ev.bind(null, e) : null);
  }
  function tv(e, t) {
    if (Iu()) return null;
    By(e, t, !0);
  }
  function Q_() {
    r2(function() {
      (wt & 6) !== 0 ? Gt(
        vn,
        Z_
      ) : Fy();
    });
  }
  function Ih() {
    if (ts === 0) {
      var e = zs;
      e === 0 && (e = ke, ke <<= 1, (ke & 261888) === 0 && (ke = 256)), ts = e;
    }
    return ts;
  }
  function nv(e) {
    return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : Ze(e);
  }
  function K_(e, t, i, l, c) {
    if (t === "submit" && i && i.stateNode === c) {
      var u = nv(
        (c[bn] || null).action
      ), x = l.submitter;
      x && (t = (t = x[bn] || null) ? nv(t.formAction) : x.getAttribute("formAction"), t !== null && (u = t, x = null));
      var T = new fr(
        "action",
        "action",
        null,
        l,
        c
      );
      e.push({
        event: T,
        listeners: [
          {
            instance: null,
            listener: function() {
              if (l.defaultPrevented) {
                if (ts !== 0) {
                  var $ = new FormData(c, x);
                  Fd(
                    i,
                    {
                      pending: !0,
                      data: $,
                      method: c.method,
                      action: u
                    },
                    null,
                    $
                  );
                }
              } else
                typeof u == "function" && (T.preventDefault(), $ = new FormData(c, x), Fd(
                  i,
                  {
                    pending: !0,
                    data: $,
                    method: c.method,
                    action: u
                  },
                  u,
                  $
                ));
            },
            currentTarget: c
          }
        ]
      });
    }
  }
  for (var Xh = 0; Xh < gd.length; Xh++) {
    var Gh = gd[Xh], P_ = Gh.toLowerCase(), J_ = Gh[0].toUpperCase() + Gh.slice(1);
    Na(
      P_,
      "on" + J_
    );
  }
  Na(Ag, "onAnimationEnd"), Na(Mg, "onAnimationIteration"), Na(zg, "onAnimationStart"), Na("dblclick", "onDoubleClick"), Na("focusin", "onFocus"), Na("focusout", "onBlur"), Na(s_, "onTransitionRun"), Na(r_, "onTransitionStart"), Na(o_, "onTransitionCancel"), Na(kg, "onTransitionEnd"), Ni("onMouseEnter", ["mouseout", "mouseover"]), Ni("onMouseLeave", ["mouseout", "mouseover"]), Ni("onPointerEnter", ["pointerout", "pointerover"]), Ni("onPointerLeave", ["pointerout", "pointerover"]), ui(
    "onChange",
    "change click focusin focusout input keydown keyup selectionchange".split(" ")
  ), ui(
    "onSelect",
    "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
      " "
    )
  ), ui("onBeforeInput", [
    "compositionend",
    "keypress",
    "textInput",
    "paste"
  ]), ui(
    "onCompositionEnd",
    "compositionend focusout keydown keypress keyup mousedown".split(" ")
  ), ui(
    "onCompositionStart",
    "compositionstart focusout keydown keypress keyup mousedown".split(" ")
  ), ui(
    "onCompositionUpdate",
    "compositionupdate focusout keydown keypress keyup mousedown".split(" ")
  );
  var Ko = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
    " "
  ), F_ = new Set(
    "beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(Ko)
  );
  function iv(e, t) {
    t = (t & 4) !== 0;
    for (var i = 0; i < e.length; i++) {
      var l = e[i], c = l.event;
      l = l.listeners;
      e: {
        var u = void 0;
        if (t)
          for (var x = l.length - 1; 0 <= x; x--) {
            var T = l[x], $ = T.instance, ie = T.currentTarget;
            if (T = T.listener, $ !== u && c.isPropagationStopped())
              break e;
            u = T, c.currentTarget = ie;
            try {
              u(c);
            } catch (fe) {
              Qc(fe);
            }
            c.currentTarget = null, u = $;
          }
        else
          for (x = 0; x < l.length; x++) {
            if (T = l[x], $ = T.instance, ie = T.currentTarget, T = T.listener, $ !== u && c.isPropagationStopped())
              break e;
            u = T, c.currentTarget = ie;
            try {
              u(c);
            } catch (fe) {
              Qc(fe);
            }
            c.currentTarget = null, u = $;
          }
      }
    }
  }
  function st(e, t) {
    var i = t[ga];
    i === void 0 && (i = t[ga] = /* @__PURE__ */ new Set());
    var l = e + "__bubble";
    i.has(l) || (av(t, e, 2, !1), i.add(l));
  }
  function Zh(e, t, i) {
    var l = 0;
    t && (l |= 4), av(
      i,
      e,
      l,
      t
    );
  }
  var Gu = "_reactListening" + Math.random().toString(36).slice(2);
  function Qh(e) {
    if (!e[Gu]) {
      e[Gu] = !0, la.forEach(function(i) {
        i !== "selectionchange" && (F_.has(i) || Zh(i, !1, e), Zh(i, !0, e));
      });
      var t = e.nodeType === 9 ? e : e.ownerDocument;
      t === null || t[Gu] || (t[Gu] = !0, Zh("selectionchange", !1, t));
    }
  }
  function av(e, t, i, l) {
    switch (Zv(t)) {
      case 2:
        var c = I2;
        break;
      case 8:
        c = X2;
        break;
      default:
        c = mm;
    }
    i = c.bind(
      null,
      t,
      i,
      e
    ), c = void 0, !bs || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (c = !0), l ? c !== void 0 ? e.addEventListener(t, i, {
      capture: !0,
      passive: c
    }) : e.addEventListener(t, i, !0) : c !== void 0 ? e.addEventListener(t, i, {
      passive: c
    }) : e.addEventListener(t, i, !1);
  }
  function Kh(e, t, i, l, c) {
    var u = l;
    if ((t & 1) === 0 && (t & 2) === 0 && l !== null)
      e: for (; ; ) {
        if (l === null) return;
        var x = l.tag;
        if (x === 3 || x === 4) {
          var T = l.stateNode.containerInfo;
          if (T === c) break;
          if (x === 4)
            for (x = l.return; x !== null; ) {
              var $ = x.tag;
              if (($ === 3 || $ === 4) && x.stateNode.containerInfo === c)
                return;
              x = x.return;
            }
          for (; T !== null; ) {
            if (x = _i(T), x === null) return;
            if ($ = x.tag, $ === 5 || $ === 6 || $ === 26 || $ === 27) {
              l = u = x;
              continue e;
            }
            T = T.parentNode;
          }
        }
        l = l.return;
      }
    Gc(function() {
      var ie = u, fe = mn(i), ve = [];
      e: {
        var W = jg.get(e);
        if (W !== void 0) {
          var ue = fr, Ae = e;
          switch (e) {
            case "keypress":
              if (cr(i) === 0) break e;
            case "keydown":
            case "keyup":
              ue = Ss;
              break;
            case "focusin":
              Ae = "focus", ue = Be;
              break;
            case "focusout":
              Ae = "blur", ue = Be;
              break;
            case "beforeblur":
            case "afterblur":
              ue = Be;
              break;
            case "click":
              if (i.button === 2) break e;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              ue = G;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              ue = F;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              ue = qw;
              break;
            case Ag:
            case Mg:
            case zg:
              ue = tt;
              break;
            case kg:
              ue = Yw;
              break;
            case "scroll":
            case "scrollend":
              ue = sd;
              break;
            case "wheel":
              ue = Xw;
              break;
            case "copy":
            case "cut":
            case "paste":
              ue = Ea;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              ue = cg;
              break;
            case "submit":
              ue = Bw;
              break;
            case "toggle":
            case "beforetoggle":
              ue = Zw;
          }
          var Oe = (t & 4) !== 0, et = !Oe && (e === "scroll" || e === "scrollend"), ne = Oe ? W !== null ? W + "Capture" : null : W;
          Oe = [];
          for (var Z = ie, se; Z !== null; ) {
            var ge = Z;
            if (se = ge.stateNode, ge = ge.tag, ge !== 5 && ge !== 26 && ge !== 27 || se === null || ne === null || (ge = wa(Z, ne), ge != null && Oe.push(
              Po(Z, ge, se)
            )), et) break;
            Z = Z.return;
          }
          0 < Oe.length && (W = new ue(
            W,
            Ae,
            null,
            i,
            fe
          ), ve.push({ event: W, listeners: Oe }));
        }
      }
      if ((t & 7) === 0) {
        e: {
          if (ue = e === "mouseover" || e === "pointerover", W = e === "mouseout" || e === "pointerout", ue && i !== fi && (Ae = i.relatedTarget || i.fromElement) && (_i(Ae) || Ae[Pe]))
            break e;
          (W || ue) && (Ae = fe.window === fe ? fe : (ue = fe.ownerDocument) ? ue.defaultView || ue.parentWindow : window, W ? (ue = i.relatedTarget || i.toElement, W = ie, ue = ue ? _i(ue) : null, ue !== null && (et = f(ue), Oe = ue.tag, ue !== et || Oe !== 5 && Oe !== 27 && Oe !== 6) && (ue = null)) : (W = null, ue = ie), W !== ue && (Oe = G, ge = "onMouseLeave", ne = "onMouseEnter", Z = "mouse", (e === "pointerout" || e === "pointerover") && (Oe = cg, ge = "onPointerLeave", ne = "onPointerEnter", Z = "pointer"), et = W == null ? Ae : $i(W), se = ue == null ? Ae : $i(ue), Ae = new Oe(
            ge,
            Z + "leave",
            W,
            i,
            fe
          ), Ae.target = et, Ae.relatedTarget = se, ge = null, _i(fe) === ie && (Oe = new Oe(
            ne,
            Z + "enter",
            ue,
            i,
            fe
          ), Oe.target = se, Oe.relatedTarget = et, ge = Oe), et = ge, Oe = W && ue ? V(
            W,
            ue,
            W_
          ) : null, W !== null && lv(
            ve,
            Ae,
            W,
            Oe,
            !1
          ), ue !== null && et !== null && lv(
            ve,
            et,
            ue,
            Oe,
            !0
          )));
        }
        e: {
          if (W = ie ? $i(ie) : window, ue = W.nodeName && W.nodeName.toLowerCase(), ue === "select" || ue === "input" && W.type === "file")
            var je = yg;
          else if (pg(W))
            if (vg)
              je = i_;
            else {
              je = t_;
              var ut = e_;
            }
          else
            ue = W.nodeName, !ue || ue.toLowerCase() !== "input" || W.type !== "checkbox" && W.type !== "radio" ? ie && ye(ie.elementType) && (je = yg) : je = n_;
          if (je && (je = je(e, ie))) {
            gg(
              ve,
              je,
              i,
              fe
            );
            break e;
          }
          ut && ut(e, W, ie);
        }
        switch (ut = ie ? $i(ie) : window, e) {
          case "focusin":
            (pg(ut) || ut.contentEditable === "true") && (mr = ut, hd = ie, No = null);
            break;
          case "focusout":
            No = hd = mr = null;
            break;
          case "mousedown":
            md = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            md = !1, Tg(ve, i, fe);
            break;
          case "selectionchange":
            if (l_) break;
          case "keydown":
          case "keyup":
            Tg(ve, i, fe);
        }
        var Le;
        if (od)
          e: {
            switch (e) {
              case "compositionstart":
                var Ie = "onCompositionStart";
                break e;
              case "compositionend":
                Ie = "onCompositionEnd";
                break e;
              case "compositionupdate":
                Ie = "onCompositionUpdate";
                break e;
            }
            Ie = void 0;
          }
        else
          hr ? hg(e, i) && (Ie = "onCompositionEnd") : e === "keydown" && i.keyCode === 229 && (Ie = "onCompositionStart");
        Ie && (ug && i.locale !== "ko" && (hr || Ie !== "onCompositionStart" ? Ie === "onCompositionEnd" && hr && (Le = wn()) : (Ga = fe, or = "value" in Ga ? Ga.value : Ga.textContent, hr = !0)), ut = Zu(ie, Ie), 0 < ut.length && (Ie = new Fn(
          Ie,
          e,
          null,
          i,
          fe
        ), ve.push({ event: Ie, listeners: ut }), Le ? Ie.data = Le : (Le = mg(i), Le !== null && (Ie.data = Le)))), (Le = Kw ? Pw(e, i) : Jw(e, i)) && (Ie = Zu(ie, "onBeforeInput"), 0 < Ie.length && (ut = new Fn(
          "onBeforeInput",
          "beforeinput",
          null,
          i,
          fe
        ), ve.push({
          event: ut,
          listeners: Ie
        }), ut.data = Le)), K_(
          ve,
          e,
          ie,
          i,
          fe
        );
      }
      iv(ve, t);
    });
  }
  function Po(e, t, i) {
    return {
      instance: e,
      listener: t,
      currentTarget: i
    };
  }
  function Zu(e, t) {
    for (var i = t + "Capture", l = []; e !== null; ) {
      var c = e, u = c.stateNode;
      if (c = c.tag, c !== 5 && c !== 26 && c !== 27 || u === null || (c = wa(e, i), c != null && l.unshift(
        Po(e, c, u)
      ), c = wa(e, t), c != null && l.push(
        Po(e, c, u)
      )), e.tag === 3) return l;
      e = e.return;
    }
    return [];
  }
  function W_(e) {
    if (e === null) return null;
    do
      e = e.return;
    while (e && e.tag !== 5 && e.tag !== 27);
    return e || null;
  }
  function lv(e, t, i, l, c) {
    for (var u = t._reactName, x = []; i !== null && i !== l; ) {
      var T = i, $ = T.alternate, ie = T.stateNode;
      if (T = T.tag, $ !== null && $ === l) break;
      T !== 5 && T !== 26 && T !== 27 || ie === null || ($ = ie, c ? (ie = wa(i, u), ie != null && x.unshift(
        Po(i, ie, $)
      )) : c || (ie = wa(i, u), ie != null && x.push(
        Po(i, ie, $)
      ))), i = i.return;
    }
    x.length !== 0 && e.push({ event: t, listeners: x });
  }
  var e2 = /\r\n?/g, t2 = /\u0000|\uFFFD/g;
  function sv(e) {
    return (typeof e == "string" ? e : "" + e).replace(e2, `
`).replace(t2, "");
  }
  function rv(e, t) {
    return t = sv(t), sv(e) === t;
  }
  function Rt(e, t, i, l, c, u) {
    switch (i) {
      case "children":
        if (typeof l == "string")
          t === "body" || t === "textarea" && l === "" || xe(e, l);
        else if (typeof l == "number" || typeof l == "bigint")
          t !== "body" && xe(e, "" + l);
        else return;
        break;
      case "className":
        hl(e, "class", l);
        break;
      case "tabIndex":
        hl(e, "tabindex", l);
        break;
      case "dir":
      case "role":
      case "viewBox":
      case "width":
      case "height":
        hl(e, i, l);
        break;
      case "style":
        be(e, l, u);
        return;
      case "data":
        if (t !== "object") {
          hl(e, "data", l);
          break;
        }
      case "src":
      case "href":
        if (l === "" && (t !== "a" || i !== "href")) {
          e.removeAttribute(i);
          break;
        }
        if (l == null || typeof l == "function" || typeof l == "symbol" || typeof l == "boolean") {
          e.removeAttribute(i);
          break;
        }
        l = Ze(l), e.setAttribute(i, l);
        break;
      case "action":
      case "formAction":
        if (typeof l == "function") {
          e.setAttribute(
            i,
            "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')"
          );
          break;
        } else
          typeof u == "function" && (i === "formAction" ? (t !== "input" && Rt(e, t, "name", c.name, c, null), Rt(
            e,
            t,
            "formEncType",
            c.formEncType,
            c,
            null
          ), Rt(
            e,
            t,
            "formMethod",
            c.formMethod,
            c,
            null
          ), Rt(
            e,
            t,
            "formTarget",
            c.formTarget,
            c,
            null
          )) : (Rt(e, t, "encType", c.encType, c, null), Rt(e, t, "method", c.method, c, null), Rt(e, t, "target", c.target, c, null)));
        if (l == null || typeof l == "symbol" || typeof l == "boolean") {
          e.removeAttribute(i);
          break;
        }
        l = Ze(l), e.setAttribute(i, l);
        break;
      case "onClick":
        l != null && (e.onclick = vt);
        return;
      case "onScroll":
        l != null && st("scroll", e);
        return;
      case "onScrollEnd":
        l != null && st("scrollend", e);
        return;
      case "dangerouslySetInnerHTML":
        if (l != null) {
          if (typeof l != "object" || !("__html" in l))
            throw Error(r(61));
          if (i = l.__html, i != null) {
            if (c.children != null) throw Error(r(60));
            u?.__html !== i && (e.innerHTML = i);
          }
        }
        break;
      case "multiple":
        e.multiple = l && typeof l != "function" && typeof l != "symbol";
        break;
      case "muted":
        e.muted = l && typeof l != "function" && typeof l != "symbol";
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "ref":
        break;
      case "autoFocus":
        break;
      case "xlinkHref":
        if (l == null || typeof l == "function" || typeof l == "boolean" || typeof l == "symbol") {
          e.removeAttribute("xlink:href");
          break;
        }
        i = Ze(l), e.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          "xlink:href",
          i
        );
        break;
      case "contentEditable":
      case "spellCheck":
      case "draggable":
      case "value":
      case "autoReverse":
      case "externalResourcesRequired":
      case "focusable":
      case "preserveAlpha":
        l != null && typeof l != "function" && typeof l != "symbol" ? e.setAttribute(i, l) : e.removeAttribute(i);
        break;
      case "inert":
      case "allowFullScreen":
      case "async":
      case "autoPlay":
      case "controls":
      case "credentialless":
      case "default":
      case "defer":
      case "disabled":
      case "disablePictureInPicture":
      case "disableRemotePlayback":
      case "formNoValidate":
      case "hidden":
      case "loop":
      case "noModule":
      case "noValidate":
      case "open":
      case "playsInline":
      case "readOnly":
      case "required":
      case "reversed":
      case "scoped":
      case "seamless":
      case "itemScope":
        l && typeof l != "function" && typeof l != "symbol" ? e.setAttribute(i, "") : e.removeAttribute(i);
        break;
      case "capture":
      case "download":
        l === !0 ? e.setAttribute(i, "") : l !== !1 && l != null && typeof l != "function" && typeof l != "symbol" ? e.setAttribute(i, l) : e.removeAttribute(i);
        break;
      case "cols":
      case "rows":
      case "size":
      case "span":
        l != null && typeof l != "function" && typeof l != "symbol" && !isNaN(l) && 1 <= l ? e.setAttribute(i, l) : e.removeAttribute(i);
        break;
      case "rowSpan":
      case "start":
        l == null || typeof l == "function" || typeof l == "symbol" || isNaN(l) ? e.removeAttribute(i) : e.setAttribute(i, l);
        break;
      case "popover":
        st("beforetoggle", e), st("toggle", e), Un(e, "popover", l);
        break;
      case "xlinkActuate":
        Pn(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:actuate",
          l
        );
        break;
      case "xlinkArcrole":
        Pn(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:arcrole",
          l
        );
        break;
      case "xlinkRole":
        Pn(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:role",
          l
        );
        break;
      case "xlinkShow":
        Pn(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:show",
          l
        );
        break;
      case "xlinkTitle":
        Pn(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:title",
          l
        );
        break;
      case "xlinkType":
        Pn(
          e,
          "http://www.w3.org/1999/xlink",
          "xlink:type",
          l
        );
        break;
      case "xmlBase":
        Pn(
          e,
          "http://www.w3.org/XML/1998/namespace",
          "xml:base",
          l
        );
        break;
      case "xmlLang":
        Pn(
          e,
          "http://www.w3.org/XML/1998/namespace",
          "xml:lang",
          l
        );
        break;
      case "xmlSpace":
        Pn(
          e,
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          l
        );
        break;
      case "is":
        Un(e, "is", l);
        break;
      case "innerText":
      case "textContent":
        return;
      default:
        if (!(2 < i.length) || i[0] !== "o" && i[0] !== "O" || i[1] !== "n" && i[1] !== "N")
          i = He.get(i) || i, Un(e, i, l);
        else return;
    }
    Ke = !0;
  }
  function Ph(e, t, i, l, c, u) {
    switch (i) {
      case "style":
        be(e, l, u);
        return;
      case "dangerouslySetInnerHTML":
        if (l != null) {
          if (typeof l != "object" || !("__html" in l))
            throw Error(r(61));
          if (i = l.__html, i != null) {
            if (c.children != null) throw Error(r(60));
            u?.__html !== i && (e.innerHTML = i);
          }
        }
        break;
      case "children":
        if (typeof l == "string") xe(e, l);
        else if (typeof l == "number" || typeof l == "bigint")
          xe(e, "" + l);
        else return;
        break;
      case "onScroll":
        l != null && st("scroll", e);
        return;
      case "onScrollEnd":
        l != null && st("scrollend", e);
        return;
      case "onClick":
        l != null && (e.onclick = vt);
        return;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "innerHTML":
      case "ref":
        return;
      case "innerText":
      case "textContent":
        return;
      default:
        if (!Ia.hasOwnProperty(i))
          e: {
            if (i[0] === "o" && i[1] === "n" && (c = i.endsWith("Capture"), u = i.slice(2, c ? i.length - 7 : void 0), t = e[bn] || null, t = t != null ? t[i] : null, typeof t == "function" && e.removeEventListener(u, t, c), typeof l == "function")) {
              typeof t != "function" && t !== null && (i in e ? e[i] = null : e.hasAttribute(i) && e.removeAttribute(i)), e.addEventListener(u, l, c);
              break e;
            }
            Ke = !0, i in e ? e[i] = l : l === !0 ? e.setAttribute(i, "") : Un(e, i, l);
          }
        return;
    }
    Ke = !0;
  }
  function ii(e, t, i) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "img":
        st("error", e), st("load", e);
        var l = !1, c = !1, u;
        for (u in i)
          if (i.hasOwnProperty(u)) {
            var x = i[u];
            if (x != null)
              switch (u) {
                case "src":
                  l = !0;
                  break;
                case "srcSet":
                  c = !0;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(r(137, t));
                default:
                  Rt(e, t, u, x, i, null);
              }
          }
        c && Rt(e, t, "srcSet", i.srcSet, i, null), l && Rt(e, t, "src", i.src, i, null);
        return;
      case "input":
        st("invalid", e);
        var T = u = x = c = null, $ = null, ie = null;
        for (l in i)
          if (i.hasOwnProperty(l)) {
            var fe = i[l];
            if (fe != null)
              switch (l) {
                case "name":
                  c = fe;
                  break;
                case "type":
                  x = fe;
                  break;
                case "checked":
                  $ = fe;
                  break;
                case "defaultChecked":
                  ie = fe;
                  break;
                case "value":
                  u = fe;
                  break;
                case "defaultValue":
                  T = fe;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (fe != null)
                    throw Error(r(137, t));
                  break;
                default:
                  Rt(e, t, l, fe, i, null);
              }
          }
        ba(
          e,
          u,
          T,
          $,
          ie,
          x,
          c,
          !1
        );
        return;
      case "select":
        st("invalid", e), l = x = u = null;
        for (c in i)
          if (i.hasOwnProperty(c) && (T = i[c], T != null))
            switch (c) {
              case "value":
                u = T;
                break;
              case "defaultValue":
                x = T;
                break;
              case "multiple":
                l = T;
              default:
                Rt(e, t, c, T, i, null);
            }
        t = u, i = x, e.multiple = !!l, t != null ? Rn(e, !!l, t, !1) : i != null && Rn(e, !!l, i, !0);
        return;
      case "textarea":
        st("invalid", e), u = c = l = null;
        for (x in i)
          if (i.hasOwnProperty(x) && (T = i[x], T != null))
            switch (x) {
              case "value":
                l = T;
                break;
              case "defaultValue":
                c = T;
                break;
              case "children":
                u = T;
                break;
              case "dangerouslySetInnerHTML":
                if (T != null) throw Error(r(91));
                break;
              default:
                Rt(e, t, x, T, i, null);
            }
        Ti(e, l, c, u);
        return;
      case "option":
        for ($ in i)
          i.hasOwnProperty($) && (l = i[$], l != null) && ($ === "selected" ? e.selected = l && typeof l != "function" && typeof l != "symbol" : Rt(e, t, $, l, i, null));
        return;
      case "dialog":
        st("beforetoggle", e), st("toggle", e), st("cancel", e), st("close", e);
        break;
      case "iframe":
      case "object":
        st("load", e);
        break;
      case "video":
      case "audio":
        for (l = 0; l < Ko.length; l++)
          st(Ko[l], e);
        break;
      case "image":
        st("error", e), st("load", e);
        break;
      case "details":
        st("toggle", e);
        break;
      case "embed":
      case "source":
      case "link":
        st("error", e), st("load", e);
      case "area":
      case "base":
      case "br":
      case "col":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "track":
      case "wbr":
      case "menuitem":
        for (ie in i)
          if (i.hasOwnProperty(ie) && (l = i[ie], l != null))
            switch (ie) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(r(137, t));
              default:
                Rt(e, t, ie, l, i, null);
            }
        return;
      default:
        if (ye(t)) {
          for (fe in i)
            i.hasOwnProperty(fe) && (l = i[fe], l !== void 0 && Ph(
              e,
              t,
              fe,
              l,
              i,
              void 0
            ));
          return;
        }
    }
    for (T in i)
      i.hasOwnProperty(T) && (l = i[T], l != null && Rt(e, t, T, l, i, null));
  }
  var n2 = {};
  function i2(e, t, i, l) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "input":
        var c = null, u = null, x = null, T = null, $ = null, ie = null, fe = null;
        for (ue in i) {
          var ve = i[ue];
          if (i.hasOwnProperty(ue) && ve != null)
            switch (ue) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                $ = ve;
              default:
                l.hasOwnProperty(ue) || Rt(e, t, ue, null, l, ve);
            }
        }
        for (var W in l) {
          var ue = l[W];
          if (ve = i[W], l.hasOwnProperty(W) && (ue != null || ve != null))
            switch (W) {
              case "type":
                ue !== ve && (Ke = !0), u = ue;
                break;
              case "name":
                ue !== ve && (Ke = !0), c = ue;
                break;
              case "checked":
                ue !== ve && (Ke = !0), ie = ue;
                break;
              case "defaultChecked":
                ue !== ve && (Ke = !0), fe = ue;
                break;
              case "value":
                ue !== ve && (Ke = !0), x = ue;
                break;
              case "defaultValue":
                ue !== ve && (Ke = !0), T = ue;
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (ue != null)
                  throw Error(r(137, t));
                break;
              default:
                ue !== ve && Rt(
                  e,
                  t,
                  W,
                  ue,
                  l,
                  ve
                );
            }
        }
        qi(
          e,
          x,
          T,
          $,
          ie,
          fe,
          u,
          c
        );
        return;
      case "select":
        ue = x = T = W = null;
        for (u in i)
          if ($ = i[u], i.hasOwnProperty(u) && $ != null)
            switch (u) {
              case "value":
                break;
              case "multiple":
                ue = $;
              default:
                l.hasOwnProperty(u) || Rt(
                  e,
                  t,
                  u,
                  null,
                  l,
                  $
                );
            }
        for (c in l)
          if (u = l[c], $ = i[c], l.hasOwnProperty(c) && (u != null || $ != null))
            switch (c) {
              case "value":
                u !== $ && (Ke = !0), W = u;
                break;
              case "defaultValue":
                u !== $ && (Ke = !0), T = u;
                break;
              case "multiple":
                u !== $ && (Ke = !0), x = u;
              default:
                u !== $ && Rt(
                  e,
                  t,
                  c,
                  u,
                  l,
                  $
                );
            }
        t = T, i = x, l = ue, W != null ? Rn(e, !!i, W, !1) : !!l != !!i && (t != null ? Rn(e, !!i, t, !0) : Rn(e, !!i, i ? [] : "", !1));
        return;
      case "textarea":
        ue = W = null;
        for (T in i)
          if (c = i[T], i.hasOwnProperty(T) && c != null && !l.hasOwnProperty(T))
            switch (T) {
              case "value":
                break;
              case "children":
                break;
              default:
                Rt(e, t, T, null, l, c);
            }
        for (x in l)
          if (c = l[x], u = i[x], l.hasOwnProperty(x) && (c != null || u != null))
            switch (x) {
              case "value":
                c !== u && (Ke = !0), W = c;
                break;
              case "defaultValue":
                c !== u && (Ke = !0), ue = c;
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (c != null) throw Error(r(91));
                break;
              default:
                c !== u && Rt(e, t, x, c, l, u);
            }
        Jn(e, W, ue);
        return;
      case "option":
        for (var Ae in i)
          W = i[Ae], i.hasOwnProperty(Ae) && W != null && !l.hasOwnProperty(Ae) && (Ae === "selected" ? e.selected = !1 : Rt(
            e,
            t,
            Ae,
            null,
            l,
            W
          ));
        for ($ in l)
          W = l[$], ue = i[$], l.hasOwnProperty($) && W !== ue && (W != null || ue != null) && ($ === "selected" ? (W !== ue && (Ke = !0), e.selected = W && typeof W != "function" && typeof W != "symbol") : Rt(
            e,
            t,
            $,
            W,
            l,
            ue
          ));
        return;
      case "img":
      case "link":
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
      case "menuitem":
        for (var Oe in i)
          W = i[Oe], i.hasOwnProperty(Oe) && W != null && !l.hasOwnProperty(Oe) && Rt(e, t, Oe, null, l, W);
        for (ie in l)
          if (W = l[ie], ue = i[ie], l.hasOwnProperty(ie) && W !== ue && (W != null || ue != null))
            switch (ie) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (W != null)
                  throw Error(r(137, t));
                break;
              default:
                Rt(
                  e,
                  t,
                  ie,
                  W,
                  l,
                  ue
                );
            }
        return;
      default:
        if (ye(t)) {
          for (var et in i)
            W = i[et], i.hasOwnProperty(et) && W !== void 0 && !l.hasOwnProperty(et) && Ph(
              e,
              t,
              et,
              void 0,
              l,
              W
            );
          for (fe in l)
            W = l[fe], ue = i[fe], !l.hasOwnProperty(fe) || W === ue || W === void 0 && ue === void 0 || Ph(
              e,
              t,
              fe,
              W,
              l,
              ue
            );
          return;
        }
    }
    for (var ne in i)
      W = i[ne], i.hasOwnProperty(ne) && W != null && !l.hasOwnProperty(ne) && Rt(e, t, ne, null, l, W);
    for (ve in l)
      W = l[ve], ue = i[ve], !l.hasOwnProperty(ve) || W === ue || W == null && ue == null || Rt(e, t, ve, W, l, ue);
  }
  function ov(e) {
    switch (e) {
      case "css":
      case "script":
      case "font":
      case "img":
      case "image":
      case "input":
      case "link":
        return !0;
      default:
        return !1;
    }
  }
  function a2() {
    if (typeof performance.getEntriesByType == "function") {
      for (var e = 0, t = 0, i = performance.getEntriesByType("resource"), l = 0; l < i.length; l++) {
        var c = i[l], u = c.transferSize, x = c.initiatorType, T = c.duration;
        if (u && T && ov(x)) {
          for (x = 0, T = c.responseEnd, l += 1; l < i.length; l++) {
            var $ = i[l], ie = $.startTime;
            if (ie > T) break;
            var fe = $.transferSize, ve = $.initiatorType;
            fe && ov(ve) && ($ = $.responseEnd, x += fe * ($ < T ? 1 : (T - ie) / ($ - ie)));
          }
          if (--l, t += 8 * (u + x) / (c.duration / 1e3), e++, 10 < e) break;
        }
      }
      if (0 < e) return t / e / 1e6;
    }
    return navigator.connection && (e = navigator.connection.downlink, typeof e == "number") ? e : 5;
  }
  var Jh = null, Fh = null;
  function Jo(e) {
    return e.nodeType === 9 ? e : e.ownerDocument;
  }
  function cv(e) {
    switch (e) {
      case "http://www.w3.org/2000/svg":
        return 1;
      case "http://www.w3.org/1998/Math/MathML":
        return 2;
      default:
        return 0;
    }
  }
  function uv(e, t) {
    if (e === 0)
      switch (t) {
        case "svg":
          return 1;
        case "math":
          return 2;
        default:
          return 0;
      }
    return e === 1 && t === "foreignObject" ? 0 : e;
  }
  function fv(e, t, i, l) {
    return i = Jo(
      i
    ).createElement(e), i[qt] = l, i[bn] = t, ii(i, e, t), yt(i), i;
  }
  function Wh(e, t) {
    return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
  }
  var em = null;
  function l2() {
    var e = window.event;
    return e && e.type === "popstate" ? e === em ? !1 : (em = e, !0) : (em = null, !1);
  }
  var tm = typeof setTimeout == "function" ? setTimeout : void 0, s2 = typeof clearTimeout == "function" ? clearTimeout : void 0, dv = typeof Promise == "function" ? Promise : void 0, hv = typeof requestAnimationFrame == "function" ? requestAnimationFrame : tm, r2 = typeof queueMicrotask == "function" ? queueMicrotask : typeof dv < "u" ? function(e) {
    return dv.resolve(null).then(e).catch(o2);
  } : tm;
  function o2(e) {
    setTimeout(function() {
      throw e;
    });
  }
  function ns(e) {
    return e === "head";
  }
  function mv(e, t) {
    var i = t, l = 0;
    do {
      var c = i.nextSibling;
      if (e.removeChild(i), c && c.nodeType === 8)
        if (i = c.data, i === "/$" || i === "/&") {
          if (l === 0) {
            e.removeChild(c), Zr(t);
            return;
          }
          l--;
        } else if (i === "$" || i === "$?" || i === "$~" || i === "$!" || i === "&")
          l++;
        else if (i === "html")
          cm(
            e.ownerDocument.documentElement
          );
        else if (i === "head") {
          i = e.ownerDocument.head, cm(i);
          for (var u = i.firstChild; u; ) {
            var x = u.nextSibling, T = u.nodeName;
            u[Bi] || T === "SCRIPT" || T === "STYLE" || T === "LINK" && u.rel.toLowerCase() === "stylesheet" || i.removeChild(u), u = x;
          }
        } else
          i === "body" && cm(e.ownerDocument.body);
      i = c;
    } while (i);
    Zr(t);
  }
  function pv(e, t) {
    var i = e;
    e = 0;
    do {
      var l = i.nextSibling;
      if (i.nodeType === 1 ? t ? (i._stashedDisplay = i.style.display, i.style.display = "none") : (i.style.display = i._stashedDisplay || "", i.getAttribute("style") === "" && i.removeAttribute("style")) : i.nodeType === 3 && (t ? (i._stashedText = i.nodeValue, i.nodeValue = "") : i.nodeValue = i._stashedText || ""), l && l.nodeType === 8)
        if (i = l.data, i === "/$") {
          if (e === 0) break;
          e--;
        } else
          i !== "$" && i !== "$?" && i !== "$~" && i !== "$!" || e++;
      i = l;
    } while (i);
  }
  function gv(e, t, i) {
    if (t = CSS.escape(t) !== t ? "r-" + btoa(t).replace(/=/g, "") : t, e.style.viewTransitionName = t, i != null && (e.style.viewTransitionClass = i), i = getComputedStyle(e), i.display === "inline") {
      if (t = e.getClientRects(), t.length === 1) var l = 1;
      else
        for (var c = l = 0; c < t.length; c++) {
          var u = t[c];
          0 < u.width && 0 < u.height && l++;
        }
      l === 1 && (e = e.style, e.display = t.length === 1 ? "inline-block" : "block", e.marginTop = "-" + i.paddingTop, e.marginBottom = "-" + i.paddingBottom);
    }
  }
  function yv(e, t) {
    e = e.style, t = t.style;
    var i = t != null ? t.hasOwnProperty("viewTransitionName") ? t.viewTransitionName : t.hasOwnProperty("view-transition-name") ? t["view-transition-name"] : null : null;
    e.viewTransitionName = i == null || typeof i == "boolean" ? "" : ("" + i).trim(), i = t != null ? t.hasOwnProperty("viewTransitionClass") ? t.viewTransitionClass : t.hasOwnProperty("view-transition-class") ? t["view-transition-class"] : null : null, e.viewTransitionClass = i == null || typeof i == "boolean" ? "" : ("" + i).trim(), e.display === "inline-block" && (t == null ? e.display = e.margin = "" : (i = t.display, e.display = i == null || typeof i == "boolean" ? "" : i, i = t.margin, i != null ? e.margin = i : (i = t.hasOwnProperty("marginTop") ? t.marginTop : t["margin-top"], e.marginTop = i == null || typeof i == "boolean" ? "" : i, t = t.hasOwnProperty("marginBottom") ? t.marginBottom : t["margin-bottom"], e.marginBottom = t == null || typeof t == "boolean" ? "" : t)));
  }
  function c2(e, t, i) {
    return i = i.ownerDocument.defaultView, {
      rect: e,
      abs: t.position === "absolute" || t.position === "fixed",
      clip: t.clipPath !== "none" || t.overflow !== "visible" || t.filter !== "none" || t.mask !== "none" || t.mask !== "none" || t.borderRadius !== "0px",
      view: 0 <= e.bottom && 0 <= e.right && e.top <= i.innerHeight && e.left <= i.innerWidth
    };
  }
  function nm(e) {
    var t = e.getBoundingClientRect(), i = getComputedStyle(e);
    return c2(t, i, e);
  }
  function u2(e) {
    return e.documentElement.clientHeight;
  }
  function f2(e) {
    this.addEventListener("load", e), this.addEventListener("error", e);
  }
  function d2(e, t, i, l, c, u, x, T, $) {
    var ie = t.nodeType === 9 ? t : t.ownerDocument;
    try {
      var fe = ie.startViewTransition({
        update: function() {
          var W = ie.defaultView, ue = W.navigation && W.navigation.transition, Ae = ie.fonts.status;
          l();
          var Oe = [];
          if (Ae === "loaded" && (u2(ie), ie.fonts.status === "loading" && Oe.push(ie.fonts.ready)), Ae = Oe.length, e !== null)
            for (var et = e.suspenseyImages, ne = 0, Z = 0; Z < et.length; Z++) {
              var se = et[Z];
              if (!se.complete) {
                var ge = se.getBoundingClientRect();
                if (0 < ge.bottom && 0 < ge.right && ge.top < W.innerHeight && ge.left < W.innerWidth) {
                  if (ne += Uv(se), ne > Pu) {
                    Oe.length = Ae;
                    break;
                  }
                  se = new Promise(
                    f2.bind(se)
                  ), Oe.push(se);
                }
              }
            }
          if (0 < Oe.length)
            return W = Promise.race([
              Promise.all(Oe),
              new Promise(function(je) {
                return setTimeout(je, 500);
              })
            ]).then(c, c), (ue ? Promise.allSettled([ue.finished, W]) : W).then(u, u);
          if (c(), ue)
            return ue.finished.then(
              u,
              u
            );
          u();
        },
        types: i
      });
      ie.__reactViewTransition = fe;
      var ve = [];
      return fe.ready.then(
        function() {
          for (var W = ie.documentElement.getAnimations({
            subtree: !0
          }), ue = 0; ue < W.length; ue++) {
            var Ae = W[ue], Oe = Ae.effect, et = Oe.pseudoElement;
            if (et != null && et.startsWith("::view-transition")) {
              ve.push(Ae), Ae = Oe.getKeyframes();
              for (var ne = et = void 0, Z = !0, se = 0; se < Ae.length; se++) {
                var ge = Ae[se], je = ge.width;
                if (et === void 0) et = je;
                else if (et !== je) {
                  Z = !1;
                  break;
                }
                if (je = ge.height, ne === void 0) ne = je;
                else if (ne !== je) {
                  Z = !1;
                  break;
                }
                delete ge.width, delete ge.height, ge.transform === "none" && delete ge.transform;
              }
              Z && et !== void 0 && ne !== void 0 && (Oe.setKeyframes(Ae), Z = getComputedStyle(
                Oe.target,
                Oe.pseudoElement
              ), Z.width !== et || Z.height !== ne) && (Z = Ae[0], Z.width = et, Z.height = ne, Z = Ae[Ae.length - 1], Z.width = et, Z.height = ne, Oe.setKeyframes(Ae));
            }
          }
          x();
        },
        function(W) {
          ie.__reactViewTransition === fe && (ie.__reactViewTransition = null);
          try {
            typeof W == "object" && W !== null && W.name === "InvalidStateError" && (W.message === "View transition was skipped because document visibility state is hidden." || W.message === "Skipping view transition because document visibility state has become hidden." || W.message === "Skipping view transition because viewport size changed." || W.message === "Transition was aborted because of invalid state") && (W = null), W !== null && $(W);
          } finally {
            l(), c(), x();
          }
        }
      ), fe.finished.finally(function() {
        for (var W = 0; W < ve.length; W++)
          ve[W].cancel();
        ie.__reactViewTransition === fe && (ie.__reactViewTransition = null), T();
      }), fe;
    } catch {
      return l(), c(), x(), null;
    }
  }
  function qs(e, t) {
    this._scope = document.documentElement, this._selector = "::view-transition-" + e + "(" + t + ")";
  }
  qs.prototype.animate = function(e, t) {
    return t = typeof t == "number" ? { duration: t } : k({}, t), t.pseudoElement = this._selector, this._scope.animate(e, t);
  }, qs.prototype.getAnimations = function() {
    for (var e = this._scope, t = this._selector, i = e.getAnimations({ subtree: !0 }), l = [], c = 0; c < i.length; c++) {
      var u = i[c].effect;
      u !== null && u.target === e && u.pseudoElement === t && l.push(i[c]);
    }
    return l;
  }, qs.prototype.getComputedStyle = function() {
    return getComputedStyle(this._scope, this._selector);
  };
  function vv(e) {
    return {
      name: e,
      group: new qs("group", e),
      imagePair: new qs("image-pair", e),
      old: new qs("old", e),
      new: new qs("new", e)
    };
  }
  function Ki(e) {
    this._fragmentFiber = e, this._observers = this._eventListeners = null;
  }
  Ki.prototype.addEventListener = function(e, t, i) {
    var l = null, c = null;
    if (!(i != null && typeof i != "boolean" && (l = i.signal || null, l !== null && l.aborted))) {
      this._eventListeners === null && (this._eventListeners = []);
      var u = this._eventListeners;
      if (bv(u, e, t, i) === -1) {
        var x = this, T = t;
        i != null && typeof i != "boolean" && i.once === !0 && (T = function($) {
          x.removeEventListener(
            e,
            t,
            i
          ), typeof t == "function" ? t.call(this, $) : t.handleEvent($);
        }), l !== null && (c = x.removeEventListener.bind(
          x,
          e,
          t,
          i
        ), l.addEventListener("abort", c, { once: !0 }), c = l.removeEventListener.bind(l, "abort", c)), l = qr(i), u.push({
          type: e,
          listener: t,
          optionsOrUseCapture: i,
          attachedListener: T,
          cleanup: c
        }), p(
          this._fragmentFiber.child,
          !1,
          h2,
          e,
          T,
          l
        );
      }
      this._eventListeners = u;
    }
  };
  function h2(e, t, i, l) {
    return _(e).addEventListener(
      t,
      i,
      l
    ), !1;
  }
  Ki.prototype.removeEventListener = function(e, t, i) {
    var l = this._eventListeners;
    if (l !== null && (t = bv(
      l,
      e,
      t,
      i
    ), t !== -1)) {
      var c = l[t];
      i = c.attachedListener;
      var u = c.cleanup;
      c = qr(c.optionsOrUseCapture), p(
        this._fragmentFiber.child,
        !1,
        m2,
        e,
        i,
        c
      ), l.splice(t, 1), u !== null && u();
    }
  };
  function m2(e, t, i, l) {
    return _(e).removeEventListener(
      t,
      i,
      l
    ), !1;
  }
  function qr(e) {
    return e != null && typeof e != "boolean" && (e.once === !0 || e.signal instanceof AbortSignal) ? { capture: e.capture, passive: e.passive } : e;
  }
  function xv(e) {
    return e == null ? "c=0" : typeof e == "boolean" ? "c=" + (e ? "1" : "0") : "c=" + (e.capture ? "1" : "0");
  }
  function bv(e, t, i, l) {
    if (e.length === 0) return -1;
    l = xv(l);
    for (var c = 0; c < e.length; c++) {
      var u = e[c];
      if (u.type === t && u.listener === i && xv(u.optionsOrUseCapture) === l)
        return c;
    }
    return -1;
  }
  Ki.prototype.dispatchEvent = function(e) {
    var t = S(
      this._fragmentFiber
    );
    if (t === null) return !0;
    t = _(t);
    var i = this._eventListeners;
    if (i !== null && 0 < i.length || !e.bubbles) {
      var l = t.nodeType === 9 ? t.createComment("") : document.createTextNode("");
      if (i)
        for (var c = 0; c < i.length; c++) {
          var u = i[c];
          l.addEventListener(
            u.type,
            u.attachedListener,
            qr(u.optionsOrUseCapture)
          );
        }
      if (t.appendChild(l), e = l.dispatchEvent(e), i)
        for (c = 0; c < i.length; c++)
          u = i[c], l.removeEventListener(
            u.type,
            u.attachedListener,
            qr(u.optionsOrUseCapture)
          );
      return t.removeChild(l), e;
    }
    return t.dispatchEvent(e);
  }, Ki.prototype.focus = function(e) {
    p(
      this._fragmentFiber.child,
      !0,
      Sv,
      e,
      void 0,
      void 0
    );
  };
  function Sv(e, t) {
    return e.tag === 6 ? !1 : (e = _(e), T2(e, t));
  }
  Ki.prototype.focusLast = function(e) {
    var t = [];
    p(
      this._fragmentFiber.child,
      !0,
      im,
      t,
      void 0,
      void 0
    );
    for (var i = t.length - 1; 0 <= i && !Sv(t[i], e); i--) ;
  };
  function im(e, t) {
    return t.push(e), !1;
  }
  Ki.prototype.blur = function() {
    var e = S(
      this._fragmentFiber
    );
    e !== null && (e = _(e), e = Jo(e).activeElement, e !== null && p(
      this._fragmentFiber.child,
      !1,
      p2,
      e,
      void 0,
      void 0
    ));
  };
  function p2(e, t) {
    return e.tag === 6 ? !1 : (e = _(e), e === t || e.contains(t) ? (t.blur(), !0) : !1);
  }
  Ki.prototype.observeUsing = function(e) {
    this._observers === null && (this._observers = /* @__PURE__ */ new Set()), this._observers.add(e), p(
      this._fragmentFiber.child,
      !1,
      g2,
      e,
      void 0,
      void 0
    );
  };
  function g2(e, t) {
    return e.tag === 6 || (e = _(e), t.observe(e)), !1;
  }
  Ki.prototype.unobserveUsing = function(e) {
    var t = this._observers;
    if (t !== null && t.has(e)) {
      t.delete(e), p(
        this._fragmentFiber.child,
        !1,
        y2,
        e,
        void 0,
        void 0
      );
      for (var i = t = 0; i < za.length; i++) {
        var l = za[i];
        l.fragmentInstance === this && l.observer === e ? e.unobserve(l.instance) : za[t++] = l;
      }
      za.length = t;
    }
  };
  function y2(e, t) {
    return e.tag === 6 || (e = _(e), t.unobserve(e)), !1;
  }
  var za = [], am = !1;
  function v2(e, t, i) {
    za.push({
      fragmentInstance: e,
      observer: t,
      instance: i
    }), am || (am = !0, C2(function() {
      am = !1;
      var l = za;
      za = [];
      for (var c = 0; c < l.length; c++) {
        var u = l[c];
        u.observer.unobserve(u.instance);
      }
    }));
  }
  Ki.prototype.getClientRects = function() {
    var e = [];
    return p(
      this._fragmentFiber.child,
      !1,
      x2,
      e,
      void 0,
      void 0
    ), e;
  };
  function x2(e, t) {
    if (e.tag === 6) {
      e = e.stateNode;
      var i = e.ownerDocument.createRange();
      i.selectNodeContents(e), t.push.apply(t, i.getClientRects());
    } else
      e = _(e), t.push.apply(t, e.getClientRects());
    return !1;
  }
  Ki.prototype.getRootNode = function(e) {
    var t = S(
      this._fragmentFiber
    );
    return t === null ? this : _(t).getRootNode(e);
  }, Ki.prototype.compareDocumentPosition = function(e) {
    var t = S(
      this._fragmentFiber
    );
    if (t === null) return Node.DOCUMENT_POSITION_DISCONNECTED;
    var i = [];
    p(
      this._fragmentFiber.child,
      !1,
      im,
      i,
      void 0,
      void 0
    );
    var l = _(t);
    if (i.length === 0) {
      if (i = l, w(this._fragmentFiber)) {
        e: {
          for (t = this._fragmentFiber.return; t !== null; ) {
            if (t.tag === 4) {
              t = t.stateNode.containerInfo;
              break e;
            }
            if (t.tag === 3 || t.tag === 5 || t.tag === 27)
              break;
            t = t.return;
          }
          t = null;
        }
        t != null && (i = t);
      }
      t = this._fragmentFiber;
      var c = l = i.compareDocumentPosition(e);
      return i === e ? c = Node.DOCUMENT_POSITION_CONTAINS : l & Node.DOCUMENT_POSITION_CONTAINED_BY && (i = E(t)[1], i === null ? c = Node.DOCUMENT_POSITION_PRECEDING : (e = _(i).compareDocumentPosition(
        e
      ), c = e === 0 || e & Node.DOCUMENT_POSITION_FOLLOWING ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)), c |= Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
    }
    t = _(i[0]), c = _(i[i.length - 1]);
    var u = w(this._fragmentFiber) ? t.parentElement : l;
    if (u == null)
      return Node.DOCUMENT_POSITION_DISCONNECTED;
    l = u.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_CONTAINED_BY, u = u.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_CONTAINED_BY;
    var x = t.compareDocumentPosition(e), T = c.compareDocumentPosition(e), $ = x & Node.DOCUMENT_POSITION_CONTAINED_BY || T & Node.DOCUMENT_POSITION_CONTAINED_BY;
    return T = l && u && x & Node.DOCUMENT_POSITION_FOLLOWING && T & Node.DOCUMENT_POSITION_PRECEDING, t = l && t === e || u && c === e || $ || T ? Node.DOCUMENT_POSITION_CONTAINED_BY : !l && t === e || !u && c === e ? Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC : x, t & Node.DOCUMENT_POSITION_DISCONNECTED || t & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC || b2(
      t,
      this._fragmentFiber,
      i[0],
      i[i.length - 1],
      e
    ) ? t : Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
  };
  function b2(e, t, i, l, c) {
    var u = _i(c);
    if (e & Node.DOCUMENT_POSITION_CONTAINED_BY) {
      if (i = !!u)
        e: {
          for (; u !== null; ) {
            if (u.tag === 7 && (u === t || u.alternate === t)) {
              i = !0;
              break e;
            }
            u = u.return;
          }
          i = !1;
        }
      return i;
    }
    if (e & Node.DOCUMENT_POSITION_CONTAINS) {
      if (u === null)
        return u = c.ownerDocument, c === u || c === u.documentElement || c === u.body;
      e: {
        for (u = t, t = S(t); u !== null; ) {
          if (!(u.tag !== 5 && u.tag !== 3 && u.tag !== 27 || u !== t && u.alternate !== t)) {
            u = !0;
            break e;
          }
          u = u.return;
        }
        u = !1;
      }
      return u;
    }
    return e & Node.DOCUMENT_POSITION_PRECEDING ? ((t = !!u) && !(t = u === i) && (t = V(
      i,
      u,
      Q
    ), t === null ? t = !1 : (p(
      t,
      !0,
      M,
      u,
      i
    ), u = C, C = null, t = u !== null)), t) : e & Node.DOCUMENT_POSITION_FOLLOWING ? ((t = !!u) && !(t = u === l) && (t = V(
      l,
      u,
      Q
    ), t === null ? t = !1 : (p(
      t,
      !0,
      R,
      u,
      l
    ), u = C, D = C = null, t = u !== null)), t) : !1;
  }
  function wv(e, t) {
    var i = e.ownerDocument.createRange();
    i.selectNodeContents(e), e = i.getBoundingClientRect(), window.scrollTo(
      window.scrollX + e.left,
      t ? window.scrollY + e.top : window.scrollY + e.bottom - window.innerHeight
    );
  }
  Ki.prototype.scrollIntoView = function(e) {
    if (typeof e == "object") throw Error(r(566));
    var t = [];
    p(
      this._fragmentFiber.child,
      !1,
      im,
      t,
      void 0,
      void 0
    );
    var i = e !== !1;
    if (t.length === 0) {
      var l = E(
        this._fragmentFiber
      );
      if (l = i ? l[1] || l[0] || S(this._fragmentFiber) : l[0] || l[1], l === null) return;
      if (l.tag === 6) {
        e = _(l), wv(e, i);
        return;
      }
      if (l = _(l), l.nodeType !== 9) {
        if (l.nodeType === 11) {
          i = "host" in l ? l.host : null, i !== null && i.scrollIntoView(e);
          return;
        }
        l.scrollIntoView(e);
      }
    }
    for (l = i ? t.length - 1 : 0; l !== (i ? -1 : t.length); ) {
      var c = t[l];
      c.tag === 6 ? (c = _(c), wv(c, i)) : _(c).scrollIntoView(e), l += i ? -1 : 1;
    }
  };
  function S2(e, t) {
    return e = _(e), _v(e, t), !1;
  }
  function _v(e, t) {
    e.reactFragments == null && (e.reactFragments = /* @__PURE__ */ new Set()), e.reactFragments.add(t);
  }
  function Ev(e, t) {
    var i = t._eventListeners;
    if (i !== null)
      for (var l = 0; l < i.length; l++) {
        var c = i[l];
        e.addEventListener(
          c.type,
          c.attachedListener,
          qr(c.optionsOrUseCapture)
        );
      }
    e.nodeType !== 3 && (i = t._observers, i !== null && i.forEach(function(u) {
      for (var x = 0, T = 0; T < za.length; T++) {
        var $ = za[T];
        ($.fragmentInstance !== t || $.observer !== u || $.instance !== e) && (za[x++] = $);
      }
      za.length = x, u.observe(e);
    }), _v(e, t));
  }
  function w2(e, t) {
    var i = t._eventListeners;
    if (i !== null)
      for (var l = 0; l < i.length; l++) {
        var c = i[l];
        e.removeEventListener(
          c.type,
          c.attachedListener,
          qr(c.optionsOrUseCapture)
        );
      }
    e.nodeType !== 3 && (i = t._observers, i !== null && i.forEach(function(u) {
      typeof u.rootMargin == "string" ? v2(
        t,
        u,
        e
      ) : u.unobserve(e);
    }), e.reactFragments != null && e.reactFragments.delete(t));
  }
  function lm(e) {
    var t = e.firstChild;
    for (t && t.nodeType === 10 && (t = t.nextSibling); t; ) {
      var i = t;
      switch (t = t.nextSibling, i.nodeName) {
        case "HTML":
        case "HEAD":
        case "BODY":
          lm(i), aa(i);
          continue;
        case "SCRIPT":
        case "STYLE":
          continue;
        case "LINK":
          if (i.rel.toLowerCase() === "stylesheet") continue;
      }
      e.removeChild(i);
    }
  }
  function _2(e, t, i, l) {
    for (; e.nodeType === 1; ) {
      var c = i;
      if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
        if (!l && (e.nodeName !== "INPUT" || e.type !== "hidden"))
          break;
      } else if (l) {
        if (!e[Bi])
          switch (t) {
            case "meta":
              if (!e.hasAttribute("itemprop")) break;
              return e;
            case "link":
              if (u = e.getAttribute("rel"), u === "stylesheet" && e.hasAttribute("data-precedence"))
                break;
              if (u !== c.rel || e.getAttribute("href") !== (c.href == null || c.href === "" ? null : c.href) || e.getAttribute("crossorigin") !== (c.crossOrigin == null ? null : c.crossOrigin) || e.getAttribute("title") !== (c.title == null ? null : c.title))
                break;
              return e;
            case "style":
              if (e.hasAttribute("data-precedence")) break;
              return e;
            case "script":
              if (u = e.getAttribute("src"), (u !== (c.src == null ? null : c.src) || e.getAttribute("type") !== (c.type == null ? null : c.type) || e.getAttribute("crossorigin") !== (c.crossOrigin == null ? null : c.crossOrigin)) && u && e.hasAttribute("async") && !e.hasAttribute("itemprop"))
                break;
              return e;
            default:
              return e;
          }
      } else if (t === "input" && e.type === "hidden") {
        var u = c.name == null ? null : "" + c.name;
        if (c.type === "hidden" && e.getAttribute("name") === u)
          return e;
      } else return e;
      if (e = ha(e.nextSibling), e === null) break;
    }
    return null;
  }
  function E2(e, t, i) {
    if (t === "") return null;
    for (; e.nodeType !== 3; )
      if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !i || (e = ha(e.nextSibling), e === null)) return null;
    return e;
  }
  function Nv(e, t) {
    for (; e.nodeType !== 8; )
      if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t || (e = ha(e.nextSibling), e === null)) return null;
    return e;
  }
  function sm(e) {
    return e.data === "$?" || e.data === "$~";
  }
  function rm(e) {
    return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState !== "loading";
  }
  function N2(e, t) {
    var i = e.ownerDocument;
    if (e.data === "$~") e._reactRetry = t;
    else if (e.data !== "$?" || i.readyState !== "loading")
      t();
    else {
      var l = function() {
        t(), i.removeEventListener("DOMContentLoaded", l);
      };
      i.addEventListener("DOMContentLoaded", l), e._reactRetry = l;
    }
  }
  function ha(e) {
    for (; e != null; e = e.nextSibling) {
      var t = e.nodeType;
      if (t === 1 || t === 3) break;
      if (t === 8) {
        if (t = e.data, t === "$" || t === "$!" || t === "$?" || t === "$~" || t === "&" || t === "F!" || t === "F")
          break;
        if (t === "/$" || t === "/&") return null;
      }
    }
    return e;
  }
  var om = null;
  function Tv(e) {
    e = e.nextSibling;
    for (var t = 0; e; ) {
      if (e.nodeType === 8) {
        var i = e.data;
        if (i === "/$" || i === "/&") {
          if (t === 0)
            return ha(e.nextSibling);
          t--;
        } else
          i !== "$" && i !== "$!" && i !== "$?" && i !== "$~" && i !== "&" || t++;
      }
      e = e.nextSibling;
    }
    return null;
  }
  function Cv(e) {
    e = e.previousSibling;
    for (var t = 0; e; ) {
      if (e.nodeType === 8) {
        var i = e.data;
        if (i === "$" || i === "$!" || i === "$?" || i === "$~" || i === "&") {
          if (t === 0) return e;
          t--;
        } else i !== "/$" && i !== "/&" || t++;
      }
      e = e.previousSibling;
    }
    return null;
  }
  function T2(e, t) {
    function i() {
      l = !0;
    }
    if (e.ownerDocument.activeElement === e) return !0;
    var l = !1;
    try {
      e.ownerDocument.addEventListener("focus", i, !0), (e.focus || HTMLElement.prototype.focus).call(e, t);
    } finally {
      e.ownerDocument.removeEventListener("focus", i, !0);
    }
    return l;
  }
  function C2(e) {
    hv(function() {
      hv(function(t) {
        return e(t);
      });
    });
  }
  function Av(e, t, i) {
    switch (t = Jo(i), e) {
      case "html":
        if (e = t.documentElement, !e) throw Error(r(452));
        return e;
      case "head":
        if (e = t.head, !e) throw Error(r(453));
        return e;
      case "body":
        if (e = t.body, !e) throw Error(r(454));
        return e;
      default:
        throw Error(r(451));
    }
  }
  function Mv(e, t, i) {
    for (var l in i) {
      var c = i[l];
      i.hasOwnProperty(l) && c != null && Rt(e, t, l, null, n2, c);
    }
    i.dangerouslySetInnerHTML != null && (e.textContent = ""), e.onclick === vt && (e.onclick = null), aa(e);
  }
  function cm(e) {
    for (var t = e.attributes; t.length; )
      e.removeAttributeNode(t[0]);
    aa(e);
  }
  var ma = /* @__PURE__ */ new Map(), zv = /* @__PURE__ */ new Set();
  function Fo(e) {
    if (typeof e.getRootNode == "function") {
      var t = e.getRootNode();
      if (t.nodeType === 9 || t.nodeType === 11) return t;
    }
    return e.nodeType === 9 ? e : e.ownerDocument;
  }
  var Tl = Ne.d;
  Ne.d = {
    f: A2,
    r: M2,
    D: z2,
    C: k2,
    L: j2,
    m: R2,
    X: D2,
    S: O2,
    M: H2
  };
  function A2() {
    var e = Tl.f(), t = qu();
    return e || t;
  }
  function M2(e) {
    var t = Ei(e);
    t !== null && t.tag === 5 && t.type === "form" ? j0(t) : Tl.r(e);
  }
  var Vr = typeof document > "u" ? null : document;
  function kv(e, t, i) {
    var l = Vr;
    if (l && typeof t == "string" && t) {
      var c = Bn(t);
      c = 'link[rel="' + e + '"][href="' + c + '"]', typeof i == "string" && (c += '[crossorigin="' + i + '"]'), zv.has(c) || (zv.add(c), e = { rel: e, crossOrigin: i, href: t }, l.querySelector(c) === null && (t = l.createElement("link"), ii(t, "link", e), yt(t), l.head.appendChild(t)));
    }
  }
  function z2(e) {
    Tl.D(e), kv("dns-prefetch", e, null);
  }
  function k2(e, t) {
    Tl.C(e, t), kv("preconnect", e, t);
  }
  function j2(e, t, i) {
    Tl.L(e, t, i);
    var l = Vr;
    if (l && e && t) {
      var c = 'link[rel="preload"][as="' + Bn(t) + '"]';
      t === "image" && i && i.imageSrcSet ? (c += '[imagesrcset="' + Bn(
        i.imageSrcSet
      ) + '"]', typeof i.imageSizes == "string" && (c += '[imagesizes="' + Bn(
        i.imageSizes
      ) + '"]')) : c += '[href="' + Bn(e) + '"]';
      var u = c;
      switch (t) {
        case "style":
          u = Yr(e);
          break;
        case "script":
          u = Ir(e);
      }
      if (!(ma.has(u) || (e = k(
        {
          rel: "preload",
          href: t === "image" && i && i.imageSrcSet ? void 0 : e,
          as: t
        },
        i
      ), ma.set(u, e), l.querySelector(c) !== null || t === "style" && l.querySelector(Wo(u)) || t === "script" && l.querySelector(ec(u))))) {
        var x = l.createElement("link");
        ii(x, "link", e), t === "style" && (x[ia] = !0, x.onload = x.onerror = function() {
          ci(x);
        }), yt(x), l.head.appendChild(x);
      }
    }
  }
  function R2(e, t) {
    Tl.m(e, t);
    var i = Vr;
    if (i && e) {
      var l = t && typeof t.as == "string" ? t.as : "script", c = 'link[rel="modulepreload"][as="' + Bn(l) + '"][href="' + Bn(e) + '"]', u = c;
      switch (l) {
        case "audioworklet":
        case "paintworklet":
        case "serviceworker":
        case "sharedworker":
        case "worker":
        case "script":
          u = Ir(e);
      }
      if (!ma.has(u) && (e = k({ rel: "modulepreload", href: e }, t), ma.set(u, e), i.querySelector(c) === null)) {
        switch (l) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            if (i.querySelector(ec(u)))
              return;
        }
        l = i.createElement("link"), ii(l, "link", e), yt(l), i.head.appendChild(l);
      }
    }
  }
  function O2(e, t, i) {
    Tl.S(e, t, i);
    var l = Vr;
    if (l && e) {
      var c = jn(l).hoistableStyles, u = Yr(e);
      t = t || "default";
      var x = c.get(u);
      if (!x) {
        var T = { loading: 0, preload: null };
        if (x = l.querySelector(
          Wo(u)
        ))
          T.loading = 5;
        else {
          e = k(
            { rel: "stylesheet", href: e, "data-precedence": t },
            i
          ), (i = ma.get(u)) && um(e, i);
          var $ = x = l.createElement("link");
          yt($), ii($, "link", e), $._p = new Promise(function(ie, fe) {
            $.onload = ie, $.onerror = fe;
          }), $.addEventListener("load", function() {
            T.loading |= 1;
          }), $.addEventListener("error", function() {
            T.loading |= 2;
          }), T.loading |= 4, Qu(x, t, l);
        }
        x = {
          type: "stylesheet",
          instance: x,
          count: 1,
          state: T
        }, c.set(u, x);
      }
    }
  }
  function D2(e, t) {
    Tl.X(e, t);
    var i = Vr;
    if (i && e) {
      var l = jn(i).hoistableScripts, c = Ir(e), u = l.get(c);
      u || (u = i.querySelector(ec(c)), u || (e = k({ src: e, async: !0 }, t), (t = ma.get(c)) && fm(e, t), u = i.createElement("script"), yt(u), ii(u, "link", e), i.head.appendChild(u)), u = {
        type: "script",
        instance: u,
        count: 1,
        state: null
      }, l.set(c, u));
    }
  }
  function H2(e, t) {
    Tl.M(e, t);
    var i = Vr;
    if (i && e) {
      var l = jn(i).hoistableScripts, c = Ir(e), u = l.get(c);
      u || (u = i.querySelector(ec(c)), u || (e = k({ src: e, async: !0, type: "module" }, t), (t = ma.get(c)) && fm(e, t), u = i.createElement("script"), yt(u), ii(u, "link", e), i.head.appendChild(u)), u = {
        type: "script",
        instance: u,
        count: 1,
        state: null
      }, l.set(c, u));
    }
  }
  function jv(e, t, i, l) {
    var c = (c = At.current) ? Fo(c) : null;
    if (!c) throw Error(r(446));
    switch (e) {
      case "meta":
      case "title":
        return null;
      case "style":
        return typeof i.precedence == "string" && typeof i.href == "string" ? (i = Yr(i.href), t = jn(
          c
        ).hoistableStyles, l = t.get(i), l || (l = {
          type: "style",
          instance: null,
          count: 0,
          state: null
        }, t.set(i, l)), l) : { type: "void", instance: null, count: 0, state: null };
      case "link":
        if (i.rel === "stylesheet" && typeof i.href == "string" && typeof i.precedence == "string") {
          e = Yr(i.href);
          var u = jn(
            c
          ).hoistableStyles, x = u.get(e);
          if (x || (c = c.ownerDocument || c, x = {
            type: "stylesheet",
            instance: null,
            count: 0,
            state: { loading: 0, preload: null }
          }, u.set(e, x), (u = c.querySelector(
            Wo(e)
          )) ? u._p || (x.instance = u, x.state.loading = 5) : (u = ma.get(e), u || (u = {
            rel: "preload",
            as: "style",
            href: i.href,
            crossOrigin: i.crossOrigin,
            integrity: i.integrity,
            media: i.media,
            hrefLang: i.hrefLang,
            referrerPolicy: i.referrerPolicy
          }, ma.set(e, u)), L2(
            c,
            e,
            u,
            x.state
          ))), t && l === null)
            throw Error(r(528, ""));
          return x;
        }
        if (t && l !== null)
          throw Error(r(529, ""));
        return null;
      case "script":
        return t = i.async, i = i.src, typeof i == "string" && t && typeof t != "function" && typeof t != "symbol" ? (i = Ir(i), t = jn(
          c
        ).hoistableScripts, l = t.get(i), l || (l = {
          type: "script",
          instance: null,
          count: 0,
          state: null
        }, t.set(i, l)), l) : { type: "void", instance: null, count: 0, state: null };
      default:
        throw Error(r(444, e));
    }
  }
  function Yr(e) {
    return 'href="' + Bn(e) + '"';
  }
  function Wo(e) {
    return 'link[rel="stylesheet"][' + e + "]";
  }
  function Rv(e) {
    return k({}, e, {
      "data-precedence": e.precedence,
      precedence: null
    });
  }
  function L2(e, t, i, l) {
    if (t = e.querySelector(
      'link[rel="preload"][as="style"][' + t + "]"
    )) {
      if (t[ia] !== !0) {
        l.loading = 1;
        return;
      }
    } else
      t = e.createElement("link"), t[ia] = !0, t.onload = t.onerror = ci.bind(null, t), ii(t, "link", i), yt(t), e.head.appendChild(t);
    l.preload = t, t.addEventListener("load", function() {
      return l.loading |= 1;
    }), t.addEventListener("error", function() {
      return l.loading |= 2;
    });
  }
  function Ir(e) {
    return '[src="' + Bn(e) + '"]';
  }
  function ec(e) {
    return "script[async]" + e;
  }
  function Ov(e, t, i) {
    if (t.count++, t.instance === null)
      switch (t.type) {
        case "style":
          var l = e.querySelector(
            'style[data-href~="' + Bn(i.href) + '"]'
          );
          if (l)
            return t.instance = l, yt(l), l;
          var c = k({}, i, {
            "data-href": i.href,
            "data-precedence": i.precedence,
            href: null,
            precedence: null
          });
          return l = (e.ownerDocument || e).createElement(
            "style"
          ), yt(l), ii(l, "style", c), Qu(l, i.precedence, e), t.instance = l;
        case "stylesheet":
          c = Yr(i.href);
          var u = e.querySelector(
            Wo(c)
          );
          if (u)
            return t.state.loading |= 4, t.instance = u, yt(u), u;
          l = Rv(i), (c = ma.get(c)) && um(l, c), u = (e.ownerDocument || e).createElement("link"), yt(u);
          var x = u;
          return x._p = new Promise(function(T, $) {
            x.onload = T, x.onerror = $;
          }), ii(u, "link", l), t.state.loading |= 4, Qu(u, i.precedence, e), t.instance = u;
        case "script":
          return u = Ir(i.src), (c = e.querySelector(
            ec(u)
          )) ? (t.instance = c, yt(c), c) : (l = i, (c = ma.get(u)) && (l = k({}, i), fm(l, c)), e = e.ownerDocument || e, c = e.createElement("script"), yt(c), ii(c, "link", l), e.head.appendChild(c), t.instance = c);
        case "void":
          return null;
        default:
          throw Error(r(443, t.type));
      }
    else
      t.type === "stylesheet" && (t.state.loading & 4) === 0 && (l = t.instance, t.state.loading |= 4, Qu(l, i.precedence, e));
    return t.instance;
  }
  function Qu(e, t, i) {
    for (var l = i.querySelectorAll(
      'link[rel="stylesheet"][data-precedence],style[data-precedence]'
    ), c = l.length ? l[l.length - 1] : null, u = c, x = 0; x < l.length; x++) {
      var T = l[x];
      if (T.dataset.precedence === t) u = T;
      else if (u !== c) break;
    }
    u ? u.parentNode.insertBefore(e, u.nextSibling) : (t = i.nodeType === 9 ? i.head : i, t.insertBefore(e, t.firstChild));
  }
  function um(e, t) {
    e.crossOrigin == null && (e.crossOrigin = t.crossOrigin), e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy), e.title == null && (e.title = t.title);
  }
  function fm(e, t) {
    e.crossOrigin == null && (e.crossOrigin = t.crossOrigin), e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy), e.integrity == null && (e.integrity = t.integrity);
  }
  var Ku = null;
  function Dv(e, t, i) {
    if (Ku === null) {
      var l = /* @__PURE__ */ new Map(), c = Ku = /* @__PURE__ */ new Map();
      c.set(i, l);
    } else
      c = Ku, l = c.get(i), l || (l = /* @__PURE__ */ new Map(), c.set(i, l));
    if (l.has(e)) return l;
    for (l.set(e, null), i = i.getElementsByTagName(e), c = 0; c < i.length; c++) {
      var u = i[c];
      if (!(u[Bi] || u[qt] || e === "link" && u.getAttribute("rel") === "stylesheet") && u.namespaceURI !== "http://www.w3.org/2000/svg") {
        var x = u.getAttribute(t) || "";
        x = e + x;
        var T = l.get(x);
        T ? T.push(u) : l.set(x, [u]);
      }
    }
    return l;
  }
  function dm(e, t, i) {
    e = e.ownerDocument || e, e.head.insertBefore(
      i,
      t === "title" ? e.querySelector("head > title") : null
    );
  }
  function U2(e, t, i) {
    if (i === 1 || t.itemProp != null) return !1;
    switch (e) {
      case "meta":
      case "title":
        return !0;
      case "style":
        if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "")
          break;
        return !0;
      case "link":
        if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError)
          break;
        return t.rel === "stylesheet" ? (e = t.disabled, typeof t.precedence == "string" && e == null) : !0;
      case "script":
        if (t.async && typeof t.async != "function" && typeof t.async != "symbol" && !t.onLoad && !t.onError && t.src && typeof t.src == "string")
          return !0;
    }
    return !1;
  }
  function Hv(e, t) {
    return e === "img" && t.src != null && t.src !== "" && t.onLoad == null && t.loading !== "lazy";
  }
  function Lv(e) {
    return !(e.type === "stylesheet" && (e.state.loading & 3) === 0);
  }
  function Uv(e) {
    return (e.width || 100) * (e.height || 100) * (typeof devicePixelRatio == "number" ? devicePixelRatio : 1) * 0.25;
  }
  function Bv(e, t) {
    typeof t.decode == "function" && (e.imgCount++, t.complete || (e.imgBytes += Uv(t), e.suspenseyImages.push(t)), e = q2.bind(e), t.decode().then(e, e));
  }
  function B2(e, t, i, l) {
    if (i.type === "stylesheet" && (typeof l.media != "string" || matchMedia(l.media).matches !== !1) && (i.state.loading & 4) === 0) {
      if (i.instance === null) {
        var c = Yr(l.href), u = t.querySelector(
          Wo(c)
        );
        if (u) {
          t = u._p, t !== null && typeof t == "object" && typeof t.then == "function" && (e.count++, e = tc.bind(e), t.then(e, e)), i.state.loading |= 4, i.instance = u, yt(u);
          return;
        }
        u = t.ownerDocument || t, l = Rv(l), (c = ma.get(c)) && um(l, c), u = u.createElement("link"), yt(u);
        var x = u;
        x._p = new Promise(function(T, $) {
          x.onload = T, x.onerror = $;
        }), ii(u, "link", l), i.instance = u;
      }
      e.stylesheets === null && (e.stylesheets = /* @__PURE__ */ new Map()), e.stylesheets.set(i, t), (t = i.state.preload) && (i.state.loading & 3) === 0 && (e.count++, i = tc.bind(e), t.addEventListener("load", i), t.addEventListener("error", i));
    }
  }
  var Pu = 0;
  function $2(e, t) {
    return e.stylesheets && e.count === 0 && Fu(e, e.stylesheets), 0 < e.count || 0 < e.imgCount ? function(i) {
      var l = setTimeout(function() {
        if (e.stylesheets && Fu(e, e.stylesheets), e.unsuspend) {
          var u = e.unsuspend;
          e.unsuspend = null, u();
        }
      }, 6e4 + t);
      0 < e.imgBytes && Pu === 0 && (Pu = 62500 * a2());
      var c = setTimeout(
        function() {
          if (e.waitingForImages = !1, e.count === 0 && (e.stylesheets && Fu(e, e.stylesheets), e.unsuspend)) {
            var u = e.unsuspend;
            e.unsuspend = null, u();
          }
        },
        (e.imgBytes > Pu ? 50 : 800) + t
      );
      return e.unsuspend = i, function() {
        e.unsuspend = null, clearTimeout(l), clearTimeout(c);
      };
    } : null;
  }
  function $v(e) {
    if (e.count === 0 && (e.imgCount === 0 || !e.waitingForImages)) {
      if (e.stylesheets) Fu(e, e.stylesheets);
      else if (e.unsuspend) {
        var t = e.unsuspend;
        e.unsuspend = null, t();
      }
    }
  }
  function tc() {
    this.count--, $v(this);
  }
  function q2() {
    this.imgCount--, $v(this);
  }
  var Ju = null;
  function Fu(e, t) {
    e.stylesheets = null, e.unsuspend !== null && (e.count++, Ju = /* @__PURE__ */ new Map(), t.forEach(V2, e), Ju = null, tc.call(e));
  }
  function V2(e, t) {
    if (!(t.state.loading & 4)) {
      var i = Ju.get(e);
      if (i) var l = i.get(null);
      else {
        i = /* @__PURE__ */ new Map(), Ju.set(e, i);
        for (var c = e.querySelectorAll(
          "link[data-precedence],style[data-precedence]"
        ), u = 0; u < c.length; u++) {
          var x = c[u];
          (x.nodeName === "LINK" || x.getAttribute("media") !== "not all") && (i.set(x.dataset.precedence, x), l = x);
        }
        l && i.set(null, l);
      }
      c = t.instance, x = c.getAttribute("data-precedence"), u = i.get(x) || l, u === l && i.set(null, c), i.set(x, c), this.count++, l = tc.bind(this), c.addEventListener("load", l), c.addEventListener("error", l), u ? u.parentNode.insertBefore(c, u.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(c, e.firstChild)), t.state.loading |= 4;
    }
  }
  var Xr = {
    $$typeof: Y,
    Provider: null,
    Consumer: null,
    _currentValue: ze,
    _currentValue2: ze,
    _threadCount: 0
  };
  function Y2(e, t, i, l, c, u, x, T, $) {
    this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = Va(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Va(0), this.hiddenUpdates = Va(null), this.identifierPrefix = l, this.onUncaughtError = c, this.onCaughtError = u, this.onRecoverableError = x, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = $, this.transitionTypes = null, this.incompleteTransitions = /* @__PURE__ */ new Map();
  }
  function qv(e, t, i, l, c, u, x, T, $, ie, fe, ve) {
    return e = new Y2(
      e,
      t,
      i,
      x,
      $,
      ie,
      fe,
      ve,
      T
    ), t = 1, u === !0 && (t |= 24), u = Mi(3, null, null, t), e.current = u, u.stateNode = e, t = Cd(), t.refCount++, e.pooledCache = t, t.refCount++, u.memoizedState = {
      element: l,
      isDehydrated: i,
      cache: t
    }, kd(u), e;
  }
  function Vv(e) {
    return e ? (e = yr, e) : yr;
  }
  function Yv(e, t, i, l, c, u) {
    c = Vv(c), l.context === null ? l.context = c : l.pendingContext = c, l = Il(t), l.payload = { element: i }, u = u === void 0 ? null : u, u !== null && (l.callback = u), i = Xl(e, l, t), i !== null && (Ri(i, e, t), jo(i, e, t));
  }
  function Iv(e, t) {
    if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
      var i = e.retryLane;
      e.retryLane = i !== 0 && i < t ? i : t;
    }
  }
  function hm(e, t) {
    Iv(e, t), (e = e.alternate) && Iv(e, t);
  }
  function Xv(e) {
    if (e.tag === 13 || e.tag === 31) {
      var t = Es(e, 67108864);
      t !== null && Ri(t, e, 67108864), hm(e, 67108864);
    }
  }
  function Gv(e) {
    if (e.tag === 13 || e.tag === 31) {
      var t = Qi();
      t = Ui(t);
      var i = Es(e, t);
      i !== null && Ri(i, e, t), hm(e, t);
    }
  }
  var Gr = !0;
  function I2(e, t, i, l) {
    var c = we.T;
    we.T = null;
    var u = Ne.p;
    try {
      Ne.p = 2, mm(e, t, i, l);
    } finally {
      Ne.p = u, we.T = c;
    }
  }
  function X2(e, t, i, l) {
    var c = we.T;
    we.T = null;
    var u = Ne.p;
    try {
      Ne.p = 8, mm(e, t, i, l);
    } finally {
      Ne.p = u, we.T = c;
    }
  }
  function mm(e, t, i, l) {
    if (Gr) {
      var c = pm(l);
      if (c === null)
        Kh(
          e,
          t,
          l,
          Wu,
          i
        ), Qv(e, l);
      else if (Z2(
        c,
        e,
        t,
        i,
        l
      ))
        l.stopPropagation();
      else if (Qv(e, l), t & 4 && -1 < G2.indexOf(e)) {
        for (; c !== null; ) {
          var u = Ei(c);
          if (u !== null)
            switch (u.tag) {
              case 3:
                if (u = u.stateNode, u.current.memoizedState.isDehydrated) {
                  var x = at(u.pendingLanes);
                  if (x !== 0) {
                    var T = u;
                    for (T.pendingLanes |= 2, T.entangledLanes |= 2; x; ) {
                      var $ = 1 << 31 - Mt(x);
                      T.entanglements[1] |= $, x &= ~$;
                    }
                    il(u), (wt & 6) === 0 && (Uu = Zt() + 500, Qo(0));
                  }
                }
                break;
              case 31:
              case 13:
                T = Es(u, 2), T !== null && Ri(T, u, 2), qu(), hm(u, 2);
            }
          if (u = pm(l), u === null && Kh(
            e,
            t,
            l,
            Wu,
            i
          ), u === c) break;
          c = u;
        }
        c !== null && l.stopPropagation();
      } else
        Kh(
          e,
          t,
          l,
          null,
          i
        );
    }
  }
  function pm(e) {
    return e = mn(e), gm(e);
  }
  var Wu = null;
  function gm(e) {
    if (Wu = null, e = _i(e), e !== null) {
      var t = f(e);
      if (t === null) e = null;
      else {
        var i = t.tag;
        if (i === 13) {
          if (e = h(t), e !== null) return e;
          e = null;
        } else if (i === 31) {
          if (e = m(t), e !== null) return e;
          e = null;
        } else if (i === 3) {
          if (t.stateNode.current.memoizedState.isDehydrated)
            return t.tag === 3 ? t.stateNode.containerInfo : null;
          e = null;
        } else t !== e && (e = null);
      }
    }
    return Wu = e, null;
  }
  function Zv(e) {
    switch (e) {
      case "beforetoggle":
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "seeked":
      case "submit":
      case "toggle":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "fullscreenerror":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 2;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "resize":
      case "scroll":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 8;
      case "message":
        switch (Tt()) {
          case vn:
            return 2;
          case dn:
            return 8;
          case Lt:
          case zn:
            return 32;
          case Fe:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var ym = !1, is = null, as = null, ls = null, nc = /* @__PURE__ */ new Map(), ic = /* @__PURE__ */ new Map(), ss = [], G2 = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
    " "
  );
  function Qv(e, t) {
    switch (e) {
      case "focusin":
      case "focusout":
        is = null;
        break;
      case "dragenter":
      case "dragleave":
        as = null;
        break;
      case "mouseover":
      case "mouseout":
        ls = null;
        break;
      case "pointerover":
      case "pointerout":
        nc.delete(t.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        ic.delete(t.pointerId);
    }
  }
  function ac(e, t, i, l, c, u) {
    return e === null || e.nativeEvent !== u ? (e = {
      blockedOn: t,
      domEventName: i,
      eventSystemFlags: l,
      nativeEvent: u,
      targetContainers: [c]
    }, t !== null && (t = Ei(t), t !== null && Xv(t)), e) : (e.eventSystemFlags |= l, t = e.targetContainers, c !== null && t.indexOf(c) === -1 && t.push(c), e);
  }
  function Z2(e, t, i, l, c) {
    switch (t) {
      case "focusin":
        return is = ac(
          is,
          e,
          t,
          i,
          l,
          c
        ), !0;
      case "dragenter":
        return as = ac(
          as,
          e,
          t,
          i,
          l,
          c
        ), !0;
      case "mouseover":
        return ls = ac(
          ls,
          e,
          t,
          i,
          l,
          c
        ), !0;
      case "pointerover":
        var u = c.pointerId;
        return nc.set(
          u,
          ac(
            nc.get(u) || null,
            e,
            t,
            i,
            l,
            c
          )
        ), !0;
      case "gotpointercapture":
        return u = c.pointerId, ic.set(
          u,
          ac(
            ic.get(u) || null,
            e,
            t,
            i,
            l,
            c
          )
        ), !0;
    }
    return !1;
  }
  function Kv(e) {
    var t = _i(e.target);
    if (t !== null) {
      var i = f(t);
      if (i !== null) {
        if (t = i.tag, t === 13) {
          if (t = h(i), t !== null) {
            e.blockedOn = t, ea(e.priority, function() {
              Gv(i);
            });
            return;
          }
        } else if (t === 31) {
          if (t = m(i), t !== null) {
            e.blockedOn = t, ea(e.priority, function() {
              Gv(i);
            });
            return;
          }
        } else if (t === 3 && i.stateNode.current.memoizedState.isDehydrated) {
          e.blockedOn = i.tag === 3 ? i.stateNode.containerInfo : null;
          return;
        }
      }
    }
    e.blockedOn = null;
  }
  function ef(e) {
    if (e.blockedOn !== null) return !1;
    for (var t = e.targetContainers; 0 < t.length; ) {
      var i = pm(e.nativeEvent);
      if (i === null) {
        i = e.nativeEvent;
        var l = new i.constructor(
          i.type,
          i
        );
        fi = l, i.target.dispatchEvent(l), fi = null;
      } else
        return t = Ei(i), t !== null && Xv(t), e.blockedOn = i, !1;
      t.shift();
    }
    return !0;
  }
  function Pv(e, t, i) {
    ef(e) && i.delete(t);
  }
  function Q2() {
    ym = !1, is !== null && ef(is) && (is = null), as !== null && ef(as) && (as = null), ls !== null && ef(ls) && (ls = null), nc.forEach(Pv), ic.forEach(Pv);
  }
  function tf(e, t) {
    e.blockedOn === t && (e.blockedOn = null, ym || (ym = !0, n.unstable_scheduleCallback(
      n.unstable_NormalPriority,
      Q2
    )));
  }
  var nf = null;
  function Jv(e) {
    nf !== e && (nf = e, n.unstable_scheduleCallback(
      n.unstable_NormalPriority,
      function() {
        nf === e && (nf = null);
        for (var t = 0; t < e.length; t += 3) {
          var i = e[t], l = e[t + 1], c = e[t + 2];
          if (typeof l != "function") {
            if (gm(l || i) === null)
              continue;
            break;
          }
          var u = Ei(i);
          u !== null && (e.splice(t, 3), t -= 3, Fd(
            u,
            {
              pending: !0,
              data: c,
              method: i.method,
              action: l
            },
            l,
            c
          ));
        }
      }
    ));
  }
  function Zr(e) {
    function t($) {
      return tf($, e);
    }
    is !== null && tf(is, e), as !== null && tf(as, e), ls !== null && tf(ls, e), nc.forEach(t), ic.forEach(t);
    for (var i = 0; i < ss.length; i++) {
      var l = ss[i];
      l.blockedOn === e && (l.blockedOn = null);
    }
    for (; 0 < ss.length && (i = ss[0], i.blockedOn === null); )
      Kv(i), i.blockedOn === null && ss.shift();
    if (i = (e.ownerDocument || e).$$reactFormReplay, i != null)
      for (l = 0; l < i.length; l += 3) {
        var c = i[l], u = i[l + 1], x = c[bn] || null;
        if (typeof u == "function")
          x || Jv(i);
        else if (x) {
          var T = null;
          if (u && u.hasAttribute("formAction")) {
            if (c = u, x = u[bn] || null)
              T = x.formAction;
            else if (gm(c) !== null) continue;
          } else T = x.action;
          typeof T == "function" ? i[l + 1] = T : (i.splice(l, 3), l -= 3), Jv(i);
        }
      }
  }
  function Fv() {
    function e(u) {
      u.canIntercept && u.info === "react-transition" && u.intercept({
        handler: function() {
          return new Promise(function(x) {
            return c = x;
          });
        },
        focusReset: "manual",
        scroll: "manual"
      });
    }
    function t() {
      c !== null && (c(), c = null), l || setTimeout(i, 20);
    }
    function i() {
      if (!l && !navigation.transition) {
        var u = navigation.currentEntry;
        u && u.url != null && navigation.navigate(u.url, {
          state: u.getState(),
          info: "react-transition",
          history: "replace"
        });
      }
    }
    if (typeof navigation == "object") {
      var l = !1, c = null;
      return navigation.addEventListener("navigate", e), navigation.addEventListener("navigatesuccess", t), navigation.addEventListener("navigateerror", t), setTimeout(i, 100), function() {
        l = !0, navigation.removeEventListener("navigate", e), navigation.removeEventListener("navigatesuccess", t), navigation.removeEventListener("navigateerror", t), c !== null && (c(), c = null);
      };
    }
  }
  function vm(e) {
    this._internalRoot = e;
  }
  af.prototype.render = vm.prototype.render = function(e) {
    var t = this._internalRoot;
    if (t === null) throw Error(r(409));
    var i = t.current, l = Qi();
    Yv(i, l, e, t, null, null);
  }, af.prototype.unmount = vm.prototype.unmount = function() {
    var e = this._internalRoot;
    if (e !== null) {
      this._internalRoot = null;
      var t = e.containerInfo;
      Yv(e.current, 2, null, e, null, null), qu(), t[Pe] = null;
    }
  };
  function af(e) {
    this._internalRoot = e;
  }
  af.prototype.unstable_scheduleHydration = function(e) {
    if (e) {
      var t = kn();
      e = { blockedOn: null, target: e, priority: t };
      for (var i = 0; i < ss.length && t !== 0 && t < ss[i].priority; i++) ;
      ss.splice(i, 0, e), i === 0 && Kv(e);
    }
  };
  var Wv = a.version;
  if (Wv !== "19.3.1")
    throw Error(
      r(
        527,
        Wv,
        "19.3.1"
      )
    );
  Ne.findDOMNode = function(e) {
    var t = e._reactInternals;
    if (t === void 0)
      throw typeof e.render == "function" ? Error(r(188)) : (e = Object.keys(e).join(","), Error(r(268, e)));
    return e = y(t), e = e !== null ? g(e) : null, e = e === null ? null : e.stateNode, e;
  };
  var K2 = {
    bundleType: 0,
    version: "19.3.1",
    rendererPackageName: "react-dom",
    currentDispatcherRef: we,
    reconcilerVersion: "19.3.1"
  };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var lf = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!lf.isDisabled && lf.supportsFiber)
      try {
        dt = lf.inject(
          K2
        ), en = lf;
      } catch {
      }
  }
  return sc.createRoot = function(e, t) {
    if (!o(e)) throw Error(r(299));
    var i = !1, l = "", c = V0, u = Y0, x = I0;
    return t != null && (t.unstable_strictMode === !0 && (i = !0), t.identifierPrefix !== void 0 && (l = t.identifierPrefix), t.onUncaughtError !== void 0 && (c = t.onUncaughtError), t.onCaughtError !== void 0 && (u = t.onCaughtError), t.onRecoverableError !== void 0 && (x = t.onRecoverableError)), t = qv(
      e,
      1,
      !1,
      null,
      null,
      i,
      l,
      null,
      c,
      u,
      x,
      Fv
    ), e[Pe] = t.current, Qh(e), new vm(t);
  }, sc.hydrateRoot = function(e, t, i) {
    if (!o(e)) throw Error(r(299));
    var l = !1, c = "", u = V0, x = Y0, T = I0, $ = null;
    return i != null && (i.unstable_strictMode === !0 && (l = !0), i.identifierPrefix !== void 0 && (c = i.identifierPrefix), i.onUncaughtError !== void 0 && (u = i.onUncaughtError), i.onCaughtError !== void 0 && (x = i.onCaughtError), i.onRecoverableError !== void 0 && (T = i.onRecoverableError), i.formState !== void 0 && ($ = i.formState)), t = qv(
      e,
      1,
      !0,
      t,
      i ?? null,
      l,
      c,
      $,
      u,
      x,
      T,
      Fv
    ), t.context = Vv(null), i = t.current, l = Qi(), l = Ui(l), c = Il(l), c.callback = null, Xl(i, c, l), i = l, t.current.lanes = i, nn(t, i), il(t), e[Pe] = t.current, Qh(e), new af(t);
  }, sc.version = "19.3.1", sc;
}
var cx;
function aE() {
  if (cx) return Sm.exports;
  cx = 1;
  function n() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
      } catch (a) {
        console.error(a);
      }
  }
  return n(), Sm.exports = iE(), Sm.exports;
}
var lE = aE();
const Tf = (n, a) => a.find((s) => s.id === n)?.kind === "ref_video" ? "Video" : a.find((s) => s.id === n)?.kind === "ref_audio" ? "Audio" : "Picture";
function fb(n, a, s, r) {
  return s.filter((o) => Tf(o, r) === n)[a - 1];
}
function ux(n, a, s, r, o) {
  return n.replace(/<(Picture|Video|Audio) (\d+)>/g, (f, h, m) => {
    const v = fb(h, Number(m), a, r);
    if (!v) return "";
    if (o?.mode === "frames") return v === o.first_frame && v === o.last_frame ? "首尾帧" : v === o.first_frame ? "首帧" : v === o.last_frame ? "尾帧" : "";
    const y = s.filter((g) => Tf(g, r) === h).indexOf(v);
    return y < 0 ? "" : `<${h} ${y + 1}>`;
  });
}
function sE(n, a) {
  return !n || !a || Math.abs(Math.log(n.w / n.h / (a.w / a.h))) <= 0.035;
}
const rc = (n) => n.replace(/[&<>"']/g, (a) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[a]);
function rE({ value: n, ids: a, assets: s, frames: r, onChange: o, onFocus: f, onBlur: h }) {
  const m = A.useRef(null), v = A.useRef(""), y = () => {
    function g(p) {
      if (p.nodeType === Node.TEXT_NODE) return p.textContent || "";
      if (!(p instanceof HTMLElement)) return "";
      if (p.dataset.ref) {
        const w = Tf(p.dataset.ref, s), E = a.filter((N) => Tf(N, s) === w).indexOf(p.dataset.ref);
        return E < 0 ? "" : `<${w} ${E + 1}>`;
      }
      if (p.tagName === "BR") return `
`;
      const S = [...p.childNodes].map(g).join("");
      return ["DIV", "P"].includes(p.tagName) ? S + `
` : S;
    }
    return [...m.current?.childNodes || []].map(g).join("").replace(/\n+$/, "");
  };
  return A.useEffect(() => {
    const g = m.current;
    if (!g) return;
    const p = JSON.stringify([a, r]);
    if (y() === n && v.current === p) return;
    let S = 0, w = "";
    for (const E of n.matchAll(/<(Picture|Video|Audio) (\d+)>/g)) {
      w += rc(n.slice(S, E.index)).replace(/\n/g, "<br>");
      const N = fb(E[1], Number(E[2]), a, s);
      w += N && !r ? `<span class="cv-reference-token" contenteditable="false" data-ref="${rc(N)}">${E[1] === "Picture" ? `<img src="/media/${rc(N)}" alt="">` : ""}<span>${{ Picture: "图片", Video: "视频", Audio: "音频" }[E[1]]}${E[2]}</span></span>` : rc(E[0]), S = E.index + E[0].length;
    }
    g.innerHTML = w + rc(n.slice(S)).replace(/\n/g, "<br>"), v.current = p;
  }, [n, a.join(","), r, s]), /* @__PURE__ */ d.jsx("div", { ref: m, className: "composer-prompt cv-h3-prompt", contentEditable: !0, suppressContentEditableWarning: !0, role: "textbox", "aria-label": "生成提示词", "aria-multiline": "true", "data-placeholder": r ? "描述画面的运动与首尾帧之间的过渡" : "描述想生成的视频，点击素材下方的引用插入参考", onFocus: f, onBlur: h, onInput: () => o(y().slice(0, 12e3)), onPaste: (g) => {
    g.preventDefault();
    const p = g.clipboardData.getData("text/plain"), S = getSelection();
    if (!S?.rangeCount) return;
    const w = S.getRangeAt(0);
    w.deleteContents();
    const E = document.createTextNode(p);
    w.insertNode(E), w.setStartAfter(E), w.collapse(!0), S.removeAllRanges(), S.addRange(w), o(y().slice(0, 12e3));
  } });
}
const db = (...n) => n.filter((a, s, r) => !!a && a.trim() !== "" && r.indexOf(a) === s).join(" ").trim();
const oE = (n) => n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const cE = (n) => n.replace(
  /^([A-Z])|[\s-_]+(\w)/g,
  (a, s, r) => r ? r.toUpperCase() : s.toLowerCase()
);
const fx = (n) => {
  const a = cE(n);
  return a.charAt(0).toUpperCase() + a.slice(1);
};
var uE = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
const fE = (n) => {
  for (const a in n)
    if (a.startsWith("aria-") || a === "role" || a === "title")
      return !0;
  return !1;
};
const dE = A.forwardRef(
  ({
    color: n = "currentColor",
    size: a = 24,
    strokeWidth: s = 2,
    absoluteStrokeWidth: r,
    className: o = "",
    children: f,
    iconNode: h,
    ...m
  }, v) => A.createElement(
    "svg",
    {
      ref: v,
      ...uE,
      width: a,
      height: a,
      stroke: n,
      strokeWidth: r ? Number(s) * 24 / Number(a) : s,
      className: db("lucide", o),
      ...!f && !fE(m) && { "aria-hidden": "true" },
      ...m
    },
    [
      ...h.map(([y, g]) => A.createElement(y, g)),
      ...Array.isArray(f) ? f : [f]
    ]
  )
);
const Xe = (n, a) => {
  const s = A.forwardRef(
    ({ className: r, ...o }, f) => A.createElement(dE, {
      ref: f,
      iconNode: a,
      className: db(
        `lucide-${oE(fx(n))}`,
        `lucide-${n}`,
        r
      ),
      ...o
    })
  );
  return s.displayName = fx(n), s;
};
const hE = [
  ["path", { d: "M12 5v14", key: "s699le" }],
  ["path", { d: "m19 12-7 7-7-7", key: "1idqje" }]
], hb = Xe("arrow-down", hE);
const mE = [
  ["path", { d: "M8 3 4 7l4 4", key: "9rb6wj" }],
  ["path", { d: "M4 7h16", key: "6tx8e3" }],
  ["path", { d: "m16 21 4-4-4-4", key: "siv7j2" }],
  ["path", { d: "M20 17H4", key: "h6l3hr" }]
], pE = Xe("arrow-left-right", mE);
const gE = [
  ["path", { d: "m12 19-7-7 7-7", key: "1l729n" }],
  ["path", { d: "M19 12H5", key: "x3x0zl" }]
], Cf = Xe("arrow-left", gE);
const yE = [
  ["path", { d: "m5 12 7-7 7 7", key: "hav0vg" }],
  ["path", { d: "M12 19V5", key: "x0mq9r" }]
], _c = Xe("arrow-up", yE);
const vE = [
  ["circle", { cx: "12", cy: "12", r: "4", key: "4exip2" }],
  ["path", { d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8", key: "7n84p3" }]
], mb = Xe("at-sign", vE);
const xE = [
  [
    "path",
    {
      d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
      key: "hh9hay"
    }
  ],
  ["path", { d: "m3.3 7 8.7 5 8.7-5", key: "g66t2b" }],
  ["path", { d: "M12 22V12", key: "d0xqtd" }]
], bE = Xe("box", xE);
const SE = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]], pi = Xe("check", SE);
const wE = [["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]], hs = Xe("chevron-down", wE);
const _E = [["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]], EE = Xe("chevron-left", _E);
const NE = [["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]], pb = Xe("chevron-right", NE);
const TE = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
  ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
], CE = Xe("circle-alert", TE);
const AE = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 6v6l4 2", key: "mmk7yg" }]
], dx = Xe("clock", AE);
const ME = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M12 3v18", key: "108xh3" }]
], zE = Xe("columns-2", ME);
const kE = [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
], Pr = Xe("copy", kE);
const jE = [
  ["path", { d: "M12 15V3", key: "m9g1x1" }],
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["path", { d: "m7 10 5 5 5-5", key: "brsn70" }]
], Xs = Xe("download", jE);
const RE = [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
], OE = Xe("external-link", RE);
const DE = [
  [
    "path",
    {
      d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      key: "1oefj6"
    }
  ],
  ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5", key: "wfsgrz" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
], gb = Xe("file-text", DE);
const HE = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M7 3v18", key: "bbkbws" }],
  ["path", { d: "M3 7.5h4", key: "zfgn84" }],
  ["path", { d: "M3 12h18", key: "1i2n21" }],
  ["path", { d: "M3 16.5h4", key: "1230mu" }],
  ["path", { d: "M17 3v18", key: "in4fa5" }],
  ["path", { d: "M17 7.5h4", key: "myr1c1" }],
  ["path", { d: "M17 16.5h4", key: "go4c1d" }]
], Jr = Xe("film", HE);
const LE = [
  [
    "path",
    {
      d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      key: "usdka0"
    }
  ]
], Nm = Xe("folder-open", LE);
const UE = [
  ["path", { d: "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", key: "1fvzgz" }],
  ["path", { d: "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", key: "1kc0my" }],
  ["path", { d: "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8", key: "10h0bg" }],
  [
    "path",
    {
      d: "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
      key: "1s1gnw"
    }
  ]
], BE = Xe("hand", UE);
const $E = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
], xf = Xe("image", $E);
const qE = [
  ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1", key: "1g98yp" }],
  ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1", key: "6d4xhi" }],
  ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1", key: "nxv5o0" }],
  ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1", key: "1bb6yr" }]
], Af = Xe("layout-grid", qE);
const VE = [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7", key: "10o201" }],
  ["path", { d: "M15 7h2a5 5 0 0 1 4 8", key: "1d3206" }],
  ["line", { x1: "8", x2: "12", y1: "12", y2: "12", key: "rvw6j4" }],
  ["line", { x1: "2", x2: "22", y1: "2", y2: "22", key: "a6p6uj" }]
], YE = Xe("link-2-off", VE);
const IE = [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
], Tm = Xe("link-2", IE);
const XE = [
  ["path", { d: "M21 5H3", key: "1fi0y6" }],
  ["path", { d: "M10 12H3", key: "1ulcyk" }],
  ["path", { d: "M10 19H3", key: "108z41" }],
  [
    "path",
    {
      d: "M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z",
      key: "ms4nik"
    }
  ]
], hx = Xe("list-video", XE);
const GE = [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]], If = Xe("loader-circle", GE);
const ZE = [
  [
    "path",
    {
      d: "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z",
      key: "169xi5"
    }
  ],
  ["path", { d: "M15 5.764v15", key: "1pn4in" }],
  ["path", { d: "M9 3.236v15", key: "1uimfh" }]
], QE = Xe("map", ZE);
const KE = [
  ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3", key: "1dcmit" }],
  ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3", key: "1e4gt3" }],
  ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3", key: "wsl5sc" }],
  ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3", key: "18trek" }]
], mx = Xe("maximize", KE);
const PE = [
  [
    "path",
    {
      d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
      key: "18887p"
    }
  ]
], JE = Xe("message-square", PE);
const FE = [
  ["path", { d: "M12 19v3", key: "npa21l" }],
  ["path", { d: "M19 10v2a7 7 0 0 1-14 0v-2", key: "1vc78b" }],
  ["rect", { x: "9", y: "2", width: "6", height: "13", rx: "3", key: "s6n7sd" }]
], Ap = Xe("mic", FE);
const WE = [
  [
    "path",
    {
      d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z",
      key: "edeuup"
    }
  ]
], eN = Xe("mouse-pointer-2", WE);
const tN = [
  [
    "path",
    {
      d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z",
      key: "e79jfc"
    }
  ],
  ["circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor", key: "1okk4w" }],
  ["circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor", key: "f64h9f" }],
  ["circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor", key: "qy21gx" }],
  ["circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor", key: "fotxhn" }]
], nN = Xe("palette", tN);
const iN = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }]
], aN = Xe("panel-left", iN);
const lN = [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ],
  ["path", { d: "m15 5 4 4", key: "1mk7zo" }]
], Mp = Xe("pencil", lN);
const sN = [
  [
    "path",
    {
      d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
      key: "10ikf1"
    }
  ]
], rN = Xe("play", sN);
const oN = [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
], La = Xe("plus", oN);
const cN = [
  ["path", { d: "m15 14 5-5-5-5", key: "12vg1m" }],
  ["path", { d: "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13", key: "6uklza" }]
], uN = Xe("redo-2", cN);
const fN = [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
], dN = Xe("refresh-cw", fN);
const hN = [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }]
], mN = Xe("rotate-ccw", hN);
const pN = [
  ["path", { d: "m21 21-4.34-4.34", key: "14j7rj" }],
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }]
], np = Xe("search", pN);
const gN = [
  ["path", { d: "M14 17H5", key: "gfn3mx" }],
  ["path", { d: "M19 7h-9", key: "6i9tg" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
  ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }]
], px = Xe("settings-2", gN);
const yN = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
], ip = Xe("square", yN);
const vN = [
  [
    "path",
    {
      d: "M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z",
      key: "1dfntj"
    }
  ],
  ["path", { d: "M15 3v5a1 1 0 0 0 1 1h5", key: "6s6qgf" }]
], xN = Xe("sticky-note", vN);
const bN = [
  ["path", { d: "M10 11v6", key: "nco0om" }],
  ["path", { d: "M14 11v6", key: "outv1u" }],
  ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", key: "miytrc" }],
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", key: "e791ji" }]
], Qs = Xe("trash-2", bN);
const SN = [
  ["path", { d: "M12 4v16", key: "1654pz" }],
  ["path", { d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2", key: "e0r10z" }],
  ["path", { d: "M9 20h6", key: "s66wpe" }]
], ap = Xe("type", SN);
const wN = [
  ["path", { d: "M9 14 4 9l5-5", key: "102s5s" }],
  ["path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11", key: "f3b9sd" }]
], gx = Xe("undo-2", wN);
const _N = [
  ["path", { d: "M12 3v12", key: "1x0j5s" }],
  ["path", { d: "m17 8-5-5-5 5", key: "7q97r8" }],
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }]
], lp = Xe("upload", _N);
const EN = [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
], wi = Xe("x", EN);
let cl = new URLSearchParams(location.search).get("workspace");
function yx(n) {
  cl = String(n);
  const a = new URL(location.href);
  a.searchParams.set("workspace", cl), history.replaceState(null, "", a);
}
function sl(n) {
  const a = new URL(n, location.origin);
  return cl && a.searchParams.set("workspace", cl), a.pathname + a.search + a.hash;
}
let Wr = class extends Error {
  constructor(a, s) {
    super(a), this.status = s;
  }
  status;
};
async function ln(n, a, s = a === void 0 ? "GET" : "POST") {
  const r = await fetch(n, {
    method: s,
    credentials: "same-origin",
    headers: { ...a === void 0 ? {} : { "Content-Type": "application/json" }, ...cl ? { "X-Workspace-Id": cl } : {} },
    body: a === void 0 ? void 0 : JSON.stringify(a)
  }), o = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Wr(
      typeof o.detail == "string" ? o.detail : "请求未完成，请重试",
      r.status
    );
  return o;
}
function vx(n, a, s) {
  return new Promise((r, o) => {
    const f = new XMLHttpRequest();
    f.open("POST", "/api/assets"), f.withCredentials = !0, s && (f.setRequestHeader("X-Frame-Source", s.media), f.setRequestHeader("X-Frame-Time", String(s.seconds))), cl && f.setRequestHeader("X-Workspace-Id", cl), f.upload.onprogress = (h) => {
      h.lengthComputable && a(Math.round(h.loaded / h.total * 100));
    }, f.onload = () => {
      let h;
      try {
        h = JSON.parse(f.responseText);
      } catch {
        o(new Error("上传失败"));
        return;
      }
      f.status >= 200 && f.status < 300 ? r(h) : o(new Error(h.detail || "上传失败"));
    }, f.onerror = () => o(new Error("上传中断，请重试")), f.send(n);
  });
}
function xx(n, a) {
  const s = URL.createObjectURL(
    new Blob([JSON.stringify(a, null, 2)], { type: "application/json" })
  ), r = document.createElement("a");
  r.href = s, r.download = n + ".json", r.click(), setTimeout(() => URL.revokeObjectURL(s), 1e3);
}
async function NN(n) {
  const a = n.type.startsWith("video/") ? "video" : n.type.startsWith("audio/") ? "audio" : "image", s = await fetch(a === "image" ? "/api/assets" : "/api/h3/references?kind=" + a, { method: "POST", credentials: "same-origin", headers: { ...cl ? { "X-Workspace-Id": cl } : {}, "X-File-Name": encodeURIComponent(n.name) }, body: n }), r = await s.json();
  if (!s.ok) throw new Error(typeof r.detail == "string" ? r.detail : "上传失败，请重试");
  return r;
}
const al = (n) => n?.kind === "ref_video" ? "Video" : n?.kind === "ref_audio" ? "Audio" : "Picture";
function TN({ options: n, ids: a, assets: s, onChange: r, onAsset: o, onMention: f, onBusy: h }) {
  const m = A.useRef(null), v = A.useRef(null), [y, g] = A.useState(!1), [p, S] = A.useState(""), [w, E] = A.useState(null), N = A.useRef(null), _ = A.useRef(null);
  A.useEffect(() => (w && (_.current = document.activeElement, N.current?.showModal()), () => {
    N.current?.close(), _.current?.isConnected && _.current.focus();
  }), [w]);
  const C = (k) => s.find((H) => H.id === k), D = n.mode === "frames", M = (k) => ({ Picture: "图片", Video: "视频", Audio: "音频" })[al(C(k))] + (a.filter((H) => al(C(H)) === al(C(k))).indexOf(k) + 1), R = (k, H = !1) => al(C(k)) === "Picture" ? /* @__PURE__ */ d.jsx("img", { src: "/media/" + k, alt: "" }) : al(C(k)) === "Video" ? /* @__PURE__ */ d.jsx("video", { src: "/media/" + k + "#t=0.1", muted: !H, controls: H, preload: "metadata", playsInline: !0 }) : H ? /* @__PURE__ */ d.jsx("audio", { src: "/media/" + k, controls: !0 }) : /* @__PURE__ */ d.jsx(Ap, { size: 24 }), Q = (k) => {
    v.current = k, m.current?.click();
  }, V = async (k) => {
    if (y) return;
    g(!0), h(!0), S("");
    let H = [...a], q = { ...n };
    const de = new Map(s.map((ee) => [ee.id, ee]));
    try {
      for (const ee of k) {
        if (D && (ee.type.startsWith("video/") || ee.type.startsWith("audio/"))) throw new Error("首尾帧只接收图片");
        if (!D && H.length >= 12) throw new Error("最多选择 12 个参考素材");
        const me = await NN(ee);
        if (o(me), de.set(me.id, me), D) {
          const te = v.current || (q.first_frame ? q.last_frame ? null : "last_frame" : "first_frame");
          if (!te) throw new Error("两个帧位置已填满，请先移除图片");
          const O = de.get(q[te === "first_frame" ? "last_frame" : "first_frame"] || "");
          if (!sE(O, me)) throw new Error("已保留首张图片；请更换为比例相同的另一帧");
          q = { ...q, [te]: me.id }, v.current = null;
        } else H.push(me.id);
        r(q, H);
      }
    } catch (ee) {
      S(ee.message);
    } finally {
      g(!1), h(!1);
    }
  };
  return /* @__PURE__ */ d.jsxs("div", { className: "cv-h3-inputs", "aria-busy": y, onDragOver: (k) => {
    k.dataTransfer.types.includes("Files") && k.preventDefault();
  }, onDrop: (k) => {
    k.dataTransfer.files.length && (k.preventDefault(), k.stopPropagation(), V([...k.dataTransfer.files]));
  }, onPaste: (k) => {
    k.clipboardData.files.length && (k.preventDefault(), V([...k.clipboardData.files]));
  }, children: [
    /* @__PURE__ */ d.jsx("input", { ref: m, hidden: !0, type: "file", "aria-label": "上传 H3 参考素材", accept: D ? "image/*" : "image/*,video/mp4,video/webm,video/quicktime,audio/*", multiple: !D, onChange: (k) => {
      V([...k.target.files || []]), k.target.value = "";
    } }),
    D ? /* @__PURE__ */ d.jsx("div", { className: "cv-h3-frames", children: ["first_frame", "last_frame"].map((k, H) => /* @__PURE__ */ d.jsxs("div", { className: "cv-h3-slot-wrap", children: [
      H === 1 && /* @__PURE__ */ d.jsx("button", { className: "cv-h3-swap", disabled: y || !n.first_frame && !n.last_frame, "aria-label": "交换首尾帧", onClick: () => r({ ...n, first_frame: n.last_frame, last_frame: n.first_frame }, a), children: /* @__PURE__ */ d.jsx(pE, { size: 18 }) }),
      /* @__PURE__ */ d.jsxs("div", { className: "cv-h3-card", children: [
        /* @__PURE__ */ d.jsxs("button", { disabled: y, "aria-label": (n[k] ? "预览" : "上传") + (H ? "尾帧" : "首帧"), onClick: () => n[k] ? E(n[k]) : Q(k), children: [
          n[k] ? R(n[k]) : /* @__PURE__ */ d.jsx(La, { size: 22 }),
          /* @__PURE__ */ d.jsx("span", { children: H ? "尾帧" : "首帧" })
        ] }),
        n[k] && /* @__PURE__ */ d.jsx("button", { className: "cv-h3-remove", disabled: y, "aria-label": "移除" + (H ? "尾帧" : "首帧"), onClick: () => r({ ...n, [k]: null }, a), children: /* @__PURE__ */ d.jsx(wi, { size: 12 }) })
      ] })
    ] }, k)) }) : /* @__PURE__ */ d.jsxs("div", { className: "cv-h3-strip", children: [
      a.map((k) => /* @__PURE__ */ d.jsxs("div", { className: "cv-h3-item", children: [
        /* @__PURE__ */ d.jsxs("div", { className: "cv-h3-card", children: [
          /* @__PURE__ */ d.jsxs("button", { "aria-label": "预览" + M(k), onClick: () => E(k), children: [
            R(k),
            /* @__PURE__ */ d.jsx("span", { children: M(k) })
          ] }),
          /* @__PURE__ */ d.jsx("button", { className: "cv-h3-remove", disabled: y, "aria-label": "移除" + M(k), onClick: () => r({ ...n, video_audio: n.video_audio?.filter((H) => H !== k) }, a.filter((H) => H !== k)), children: /* @__PURE__ */ d.jsx(wi, { size: 12 }) })
        ] }),
        /* @__PURE__ */ d.jsxs("button", { className: "cv-h3-mention", "aria-label": "引用" + M(k), onClick: () => f(`<${al(C(k))} ${a.filter((H) => al(C(H)) === al(C(k))).indexOf(k) + 1}>`), children: [
          /* @__PURE__ */ d.jsx(mb, { size: 12 }),
          "引用"
        ] }),
        C(k)?.kind === "ref_video" && C(k)?.has_audio && /* @__PURE__ */ d.jsxs("label", { className: "cv-h3-sound", children: [
          /* @__PURE__ */ d.jsx("input", { type: "checkbox", checked: n.video_audio?.includes(k) || !1, onChange: (H) => r({ ...n, video_audio: H.target.checked ? [...n.video_audio || [], k] : n.video_audio?.filter((q) => q !== k) }, a) }),
          "声音"
        ] })
      ] }, k)),
      /* @__PURE__ */ d.jsxs("button", { className: "cv-h3-add", disabled: y, onClick: () => Q(null), children: [
        /* @__PURE__ */ d.jsx(La, { size: 20 }),
        /* @__PURE__ */ d.jsx("span", { children: "参考内容" })
      ] })
    ] }),
    y && /* @__PURE__ */ d.jsx("p", { role: "status", children: "正在上传素材…" }),
    p && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: p }),
    w && /* @__PURE__ */ d.jsxs("dialog", { ref: N, className: "cv-h3-preview", "aria-label": "参考素材预览", onCancel: (k) => {
      k.preventDefault(), E(null);
    }, onKeyDown: (k) => {
      k.key === "Escape" && k.stopPropagation();
    }, children: [
      R(w, !0),
      /* @__PURE__ */ d.jsx("button", { autoFocus: !0, onClick: () => E(null), children: "关闭预览" })
    ] })
  ] });
}
const CN = { t2v: "文生视频", i2v: "图生视频", r2v: "参考图视频", extend: "视频续写", omni: "自动" };
function Cc(n, a) {
  return n[a]?.family || a;
}
function yb(n, a) {
  return n[a]?.family_label || n[a]?.label || a;
}
function Ec(n, a, s) {
  return Cc(n, a) === Cc(n, s);
}
function vb(n, a, s) {
  return Object.entries(n).filter(([r, o]) => Ec(n, r, a) && !o.hidden && s(r));
}
function sp(n, a, s, r = {}) {
  if (!n[a]?.family) return s(a) ? a : "";
  let o = vb(n, a, s);
  if (!o.length) return "";
  const f = [...new Set(o.map(([, p]) => p.mode))], h = r.mode || n[a]?.mode, m = f.includes(h) ? h : ["t2v", "omni", "i2v", "r2v", "extend"].find((p) => f.includes(p));
  o = o.filter(([, p]) => p.mode === m);
  const v = [...new Set(o.map(([, p]) => p.ratio))], y = v.includes(r.ratio) ? r.ratio : v.includes("16:9") ? "16:9" : v[0];
  o = o.filter(([, p]) => p.ratio === y);
  const g = Number.isFinite(r.seconds) ? Number(r.seconds) : 8;
  return o.sort(([p, S], [w, E]) => Math.abs(Number(S.seconds) - g) - Math.abs(Number(E.seconds) - g) || Number(S.seconds) - Number(E.seconds) || +(p === Cc(n, p)) - +(w === Cc(n, w)) || p.localeCompare(w)), o[0]?.[0] || "";
}
function AN(n, a, s) {
  const r = vb(n, a, s), o = n[a], f = [...new Set(r.map(([, y]) => y.mode).filter((y) => !!y))], h = r.filter(([, y]) => y.mode === o?.mode), m = [...new Set(h.map(([, y]) => y.ratio).filter((y) => !!y))], v = [...new Set(h.filter(([, y]) => y.ratio === o?.ratio).map(([, y]) => Number(y.seconds)))].sort((y, g) => y - g);
  return { modes: f, ratios: m, seconds: v };
}
function MN(n, a, s, r, o = {}) {
  const f = /* @__PURE__ */ new Set(), h = [];
  for (const [m, v] of Object.entries(n)) {
    if (!s(m) || a[m]?.hidden) continue;
    const y = Cc(a, m);
    if (f.has(y)) continue;
    f.add(y);
    const g = sp(a, m, s, { ...o, mode: Ec(a, m, r) ? a[r]?.mode : void 0 });
    g && h.push([g, a[m]?.family ? yb(a, m) : v]);
  }
  return h;
}
function An(n) {
  if (typeof n == "string" || typeof n == "number") return "" + n;
  let a = "";
  if (Array.isArray(n))
    for (let s = 0, r; s < n.length; s++)
      (r = An(n[s])) !== "" && (a += (a && " ") + r);
  else
    for (let s in n)
      n[s] && (a += (a && " ") + s);
  return a;
}
var zN = { value: () => {
} };
function Xf() {
  for (var n = 0, a = arguments.length, s = {}, r; n < a; ++n) {
    if (!(r = arguments[n] + "") || r in s || /[\s.]/.test(r)) throw new Error("illegal type: " + r);
    s[r] = [];
  }
  return new bf(s);
}
function bf(n) {
  this._ = n;
}
function kN(n, a) {
  return n.trim().split(/^|\s+/).map(function(s) {
    var r = "", o = s.indexOf(".");
    if (o >= 0 && (r = s.slice(o + 1), s = s.slice(0, o)), s && !a.hasOwnProperty(s)) throw new Error("unknown type: " + s);
    return { type: s, name: r };
  });
}
bf.prototype = Xf.prototype = {
  constructor: bf,
  on: function(n, a) {
    var s = this._, r = kN(n + "", s), o, f = -1, h = r.length;
    if (arguments.length < 2) {
      for (; ++f < h; ) if ((o = (n = r[f]).type) && (o = jN(s[o], n.name))) return o;
      return;
    }
    if (a != null && typeof a != "function") throw new Error("invalid callback: " + a);
    for (; ++f < h; )
      if (o = (n = r[f]).type) s[o] = bx(s[o], n.name, a);
      else if (a == null) for (o in s) s[o] = bx(s[o], n.name, null);
    return this;
  },
  copy: function() {
    var n = {}, a = this._;
    for (var s in a) n[s] = a[s].slice();
    return new bf(n);
  },
  call: function(n, a) {
    if ((o = arguments.length - 2) > 0) for (var s = new Array(o), r = 0, o, f; r < o; ++r) s[r] = arguments[r + 2];
    if (!this._.hasOwnProperty(n)) throw new Error("unknown type: " + n);
    for (f = this._[n], r = 0, o = f.length; r < o; ++r) f[r].value.apply(a, s);
  },
  apply: function(n, a, s) {
    if (!this._.hasOwnProperty(n)) throw new Error("unknown type: " + n);
    for (var r = this._[n], o = 0, f = r.length; o < f; ++o) r[o].value.apply(a, s);
  }
};
function jN(n, a) {
  for (var s = 0, r = n.length, o; s < r; ++s)
    if ((o = n[s]).name === a)
      return o.value;
}
function bx(n, a, s) {
  for (var r = 0, o = n.length; r < o; ++r)
    if (n[r].name === a) {
      n[r] = zN, n = n.slice(0, r).concat(n.slice(r + 1));
      break;
    }
  return s != null && n.push({ name: a, value: s }), n;
}
var rp = "http://www.w3.org/1999/xhtml", Sx = {
  svg: "http://www.w3.org/2000/svg",
  xhtml: rp,
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};
function Gf(n) {
  var a = n += "", s = a.indexOf(":");
  return s >= 0 && (a = n.slice(0, s)) !== "xmlns" && (n = n.slice(s + 1)), Sx.hasOwnProperty(a) ? { space: Sx[a], local: n } : n;
}
function RN(n) {
  return function() {
    var a = this.ownerDocument, s = this.namespaceURI;
    return s === rp && a.documentElement.namespaceURI === rp ? a.createElement(n) : a.createElementNS(s, n);
  };
}
function ON(n) {
  return function() {
    return this.ownerDocument.createElementNS(n.space, n.local);
  };
}
function xb(n) {
  var a = Gf(n);
  return (a.local ? ON : RN)(a);
}
function DN() {
}
function zp(n) {
  return n == null ? DN : function() {
    return this.querySelector(n);
  };
}
function HN(n) {
  typeof n != "function" && (n = zp(n));
  for (var a = this._groups, s = a.length, r = new Array(s), o = 0; o < s; ++o)
    for (var f = a[o], h = f.length, m = r[o] = new Array(h), v, y, g = 0; g < h; ++g)
      (v = f[g]) && (y = n.call(v, v.__data__, g, f)) && ("__data__" in v && (y.__data__ = v.__data__), m[g] = y);
  return new Wi(r, this._parents);
}
function LN(n) {
  return n == null ? [] : Array.isArray(n) ? n : Array.from(n);
}
function UN() {
  return [];
}
function bb(n) {
  return n == null ? UN : function() {
    return this.querySelectorAll(n);
  };
}
function BN(n) {
  return function() {
    return LN(n.apply(this, arguments));
  };
}
function $N(n) {
  typeof n == "function" ? n = BN(n) : n = bb(n);
  for (var a = this._groups, s = a.length, r = [], o = [], f = 0; f < s; ++f)
    for (var h = a[f], m = h.length, v, y = 0; y < m; ++y)
      (v = h[y]) && (r.push(n.call(v, v.__data__, y, h)), o.push(v));
  return new Wi(r, o);
}
function Sb(n) {
  return function() {
    return this.matches(n);
  };
}
function wb(n) {
  return function(a) {
    return a.matches(n);
  };
}
var qN = Array.prototype.find;
function VN(n) {
  return function() {
    return qN.call(this.children, n);
  };
}
function YN() {
  return this.firstElementChild;
}
function IN(n) {
  return this.select(n == null ? YN : VN(typeof n == "function" ? n : wb(n)));
}
var XN = Array.prototype.filter;
function GN() {
  return Array.from(this.children);
}
function ZN(n) {
  return function() {
    return XN.call(this.children, n);
  };
}
function QN(n) {
  return this.selectAll(n == null ? GN : ZN(typeof n == "function" ? n : wb(n)));
}
function KN(n) {
  typeof n != "function" && (n = Sb(n));
  for (var a = this._groups, s = a.length, r = new Array(s), o = 0; o < s; ++o)
    for (var f = a[o], h = f.length, m = r[o] = [], v, y = 0; y < h; ++y)
      (v = f[y]) && n.call(v, v.__data__, y, f) && m.push(v);
  return new Wi(r, this._parents);
}
function _b(n) {
  return new Array(n.length);
}
function PN() {
  return new Wi(this._enter || this._groups.map(_b), this._parents);
}
function Mf(n, a) {
  this.ownerDocument = n.ownerDocument, this.namespaceURI = n.namespaceURI, this._next = null, this._parent = n, this.__data__ = a;
}
Mf.prototype = {
  constructor: Mf,
  appendChild: function(n) {
    return this._parent.insertBefore(n, this._next);
  },
  insertBefore: function(n, a) {
    return this._parent.insertBefore(n, a);
  },
  querySelector: function(n) {
    return this._parent.querySelector(n);
  },
  querySelectorAll: function(n) {
    return this._parent.querySelectorAll(n);
  }
};
function JN(n) {
  return function() {
    return n;
  };
}
function FN(n, a, s, r, o, f) {
  for (var h = 0, m, v = a.length, y = f.length; h < y; ++h)
    (m = a[h]) ? (m.__data__ = f[h], r[h] = m) : s[h] = new Mf(n, f[h]);
  for (; h < v; ++h)
    (m = a[h]) && (o[h] = m);
}
function WN(n, a, s, r, o, f, h) {
  var m, v, y = /* @__PURE__ */ new Map(), g = a.length, p = f.length, S = new Array(g), w;
  for (m = 0; m < g; ++m)
    (v = a[m]) && (S[m] = w = h.call(v, v.__data__, m, a) + "", y.has(w) ? o[m] = v : y.set(w, v));
  for (m = 0; m < p; ++m)
    w = h.call(n, f[m], m, f) + "", (v = y.get(w)) ? (r[m] = v, v.__data__ = f[m], y.delete(w)) : s[m] = new Mf(n, f[m]);
  for (m = 0; m < g; ++m)
    (v = a[m]) && y.get(S[m]) === v && (o[m] = v);
}
function eT(n) {
  return n.__data__;
}
function tT(n, a) {
  if (!arguments.length) return Array.from(this, eT);
  var s = a ? WN : FN, r = this._parents, o = this._groups;
  typeof n != "function" && (n = JN(n));
  for (var f = o.length, h = new Array(f), m = new Array(f), v = new Array(f), y = 0; y < f; ++y) {
    var g = r[y], p = o[y], S = p.length, w = nT(n.call(g, g && g.__data__, y, r)), E = w.length, N = m[y] = new Array(E), _ = h[y] = new Array(E), C = v[y] = new Array(S);
    s(g, p, N, _, C, w, a);
    for (var D = 0, M = 0, R, Q; D < E; ++D)
      if (R = N[D]) {
        for (D >= M && (M = D + 1); !(Q = _[M]) && ++M < E; ) ;
        R._next = Q || null;
      }
  }
  return h = new Wi(h, r), h._enter = m, h._exit = v, h;
}
function nT(n) {
  return typeof n == "object" && "length" in n ? n : Array.from(n);
}
function iT() {
  return new Wi(this._exit || this._groups.map(_b), this._parents);
}
function aT(n, a, s) {
  var r = this.enter(), o = this, f = this.exit();
  return typeof n == "function" ? (r = n(r), r && (r = r.selection())) : r = r.append(n + ""), a != null && (o = a(o), o && (o = o.selection())), s == null ? f.remove() : s(f), r && o ? r.merge(o).order() : o;
}
function lT(n) {
  for (var a = n.selection ? n.selection() : n, s = this._groups, r = a._groups, o = s.length, f = r.length, h = Math.min(o, f), m = new Array(o), v = 0; v < h; ++v)
    for (var y = s[v], g = r[v], p = y.length, S = m[v] = new Array(p), w, E = 0; E < p; ++E)
      (w = y[E] || g[E]) && (S[E] = w);
  for (; v < o; ++v)
    m[v] = s[v];
  return new Wi(m, this._parents);
}
function sT() {
  for (var n = this._groups, a = -1, s = n.length; ++a < s; )
    for (var r = n[a], o = r.length - 1, f = r[o], h; --o >= 0; )
      (h = r[o]) && (f && h.compareDocumentPosition(f) ^ 4 && f.parentNode.insertBefore(h, f), f = h);
  return this;
}
function rT(n) {
  n || (n = oT);
  function a(p, S) {
    return p && S ? n(p.__data__, S.__data__) : !p - !S;
  }
  for (var s = this._groups, r = s.length, o = new Array(r), f = 0; f < r; ++f) {
    for (var h = s[f], m = h.length, v = o[f] = new Array(m), y, g = 0; g < m; ++g)
      (y = h[g]) && (v[g] = y);
    v.sort(a);
  }
  return new Wi(o, this._parents).order();
}
function oT(n, a) {
  return n < a ? -1 : n > a ? 1 : n >= a ? 0 : NaN;
}
function cT() {
  var n = arguments[0];
  return arguments[0] = this, n.apply(null, arguments), this;
}
function uT() {
  return Array.from(this);
}
function fT() {
  for (var n = this._groups, a = 0, s = n.length; a < s; ++a)
    for (var r = n[a], o = 0, f = r.length; o < f; ++o) {
      var h = r[o];
      if (h) return h;
    }
  return null;
}
function dT() {
  let n = 0;
  for (const a of this) ++n;
  return n;
}
function hT() {
  return !this.node();
}
function mT(n) {
  for (var a = this._groups, s = 0, r = a.length; s < r; ++s)
    for (var o = a[s], f = 0, h = o.length, m; f < h; ++f)
      (m = o[f]) && n.call(m, m.__data__, f, o);
  return this;
}
function pT(n) {
  return function() {
    this.removeAttribute(n);
  };
}
function gT(n) {
  return function() {
    this.removeAttributeNS(n.space, n.local);
  };
}
function yT(n, a) {
  return function() {
    this.setAttribute(n, a);
  };
}
function vT(n, a) {
  return function() {
    this.setAttributeNS(n.space, n.local, a);
  };
}
function xT(n, a) {
  return function() {
    var s = a.apply(this, arguments);
    s == null ? this.removeAttribute(n) : this.setAttribute(n, s);
  };
}
function bT(n, a) {
  return function() {
    var s = a.apply(this, arguments);
    s == null ? this.removeAttributeNS(n.space, n.local) : this.setAttributeNS(n.space, n.local, s);
  };
}
function ST(n, a) {
  var s = Gf(n);
  if (arguments.length < 2) {
    var r = this.node();
    return s.local ? r.getAttributeNS(s.space, s.local) : r.getAttribute(s);
  }
  return this.each((a == null ? s.local ? gT : pT : typeof a == "function" ? s.local ? bT : xT : s.local ? vT : yT)(s, a));
}
function Eb(n) {
  return n.ownerDocument && n.ownerDocument.defaultView || n.document && n || n.defaultView;
}
function wT(n) {
  return function() {
    this.style.removeProperty(n);
  };
}
function _T(n, a, s) {
  return function() {
    this.style.setProperty(n, a, s);
  };
}
function ET(n, a, s) {
  return function() {
    var r = a.apply(this, arguments);
    r == null ? this.style.removeProperty(n) : this.style.setProperty(n, r, s);
  };
}
function NT(n, a, s) {
  return arguments.length > 1 ? this.each((a == null ? wT : typeof a == "function" ? ET : _T)(n, a, s ?? "")) : so(this.node(), n);
}
function so(n, a) {
  return n.style.getPropertyValue(a) || Eb(n).getComputedStyle(n, null).getPropertyValue(a);
}
function TT(n) {
  return function() {
    delete this[n];
  };
}
function CT(n, a) {
  return function() {
    this[n] = a;
  };
}
function AT(n, a) {
  return function() {
    var s = a.apply(this, arguments);
    s == null ? delete this[n] : this[n] = s;
  };
}
function MT(n, a) {
  return arguments.length > 1 ? this.each((a == null ? TT : typeof a == "function" ? AT : CT)(n, a)) : this.node()[n];
}
function Nb(n) {
  return n.trim().split(/^|\s+/);
}
function kp(n) {
  return n.classList || new Tb(n);
}
function Tb(n) {
  this._node = n, this._names = Nb(n.getAttribute("class") || "");
}
Tb.prototype = {
  add: function(n) {
    var a = this._names.indexOf(n);
    a < 0 && (this._names.push(n), this._node.setAttribute("class", this._names.join(" ")));
  },
  remove: function(n) {
    var a = this._names.indexOf(n);
    a >= 0 && (this._names.splice(a, 1), this._node.setAttribute("class", this._names.join(" ")));
  },
  contains: function(n) {
    return this._names.indexOf(n) >= 0;
  }
};
function Cb(n, a) {
  for (var s = kp(n), r = -1, o = a.length; ++r < o; ) s.add(a[r]);
}
function Ab(n, a) {
  for (var s = kp(n), r = -1, o = a.length; ++r < o; ) s.remove(a[r]);
}
function zT(n) {
  return function() {
    Cb(this, n);
  };
}
function kT(n) {
  return function() {
    Ab(this, n);
  };
}
function jT(n, a) {
  return function() {
    (a.apply(this, arguments) ? Cb : Ab)(this, n);
  };
}
function RT(n, a) {
  var s = Nb(n + "");
  if (arguments.length < 2) {
    for (var r = kp(this.node()), o = -1, f = s.length; ++o < f; ) if (!r.contains(s[o])) return !1;
    return !0;
  }
  return this.each((typeof a == "function" ? jT : a ? zT : kT)(s, a));
}
function OT() {
  this.textContent = "";
}
function DT(n) {
  return function() {
    this.textContent = n;
  };
}
function HT(n) {
  return function() {
    var a = n.apply(this, arguments);
    this.textContent = a ?? "";
  };
}
function LT(n) {
  return arguments.length ? this.each(n == null ? OT : (typeof n == "function" ? HT : DT)(n)) : this.node().textContent;
}
function UT() {
  this.innerHTML = "";
}
function BT(n) {
  return function() {
    this.innerHTML = n;
  };
}
function $T(n) {
  return function() {
    var a = n.apply(this, arguments);
    this.innerHTML = a ?? "";
  };
}
function qT(n) {
  return arguments.length ? this.each(n == null ? UT : (typeof n == "function" ? $T : BT)(n)) : this.node().innerHTML;
}
function VT() {
  this.nextSibling && this.parentNode.appendChild(this);
}
function YT() {
  return this.each(VT);
}
function IT() {
  this.previousSibling && this.parentNode.insertBefore(this, this.parentNode.firstChild);
}
function XT() {
  return this.each(IT);
}
function GT(n) {
  var a = typeof n == "function" ? n : xb(n);
  return this.select(function() {
    return this.appendChild(a.apply(this, arguments));
  });
}
function ZT() {
  return null;
}
function QT(n, a) {
  var s = typeof n == "function" ? n : xb(n), r = a == null ? ZT : typeof a == "function" ? a : zp(a);
  return this.select(function() {
    return this.insertBefore(s.apply(this, arguments), r.apply(this, arguments) || null);
  });
}
function KT() {
  var n = this.parentNode;
  n && n.removeChild(this);
}
function PT() {
  return this.each(KT);
}
function JT() {
  var n = this.cloneNode(!1), a = this.parentNode;
  return a ? a.insertBefore(n, this.nextSibling) : n;
}
function FT() {
  var n = this.cloneNode(!0), a = this.parentNode;
  return a ? a.insertBefore(n, this.nextSibling) : n;
}
function WT(n) {
  return this.select(n ? FT : JT);
}
function eC(n) {
  return arguments.length ? this.property("__data__", n) : this.node().__data__;
}
function tC(n) {
  return function(a) {
    n.call(this, a, this.__data__);
  };
}
function nC(n) {
  return n.trim().split(/^|\s+/).map(function(a) {
    var s = "", r = a.indexOf(".");
    return r >= 0 && (s = a.slice(r + 1), a = a.slice(0, r)), { type: a, name: s };
  });
}
function iC(n) {
  return function() {
    var a = this.__on;
    if (a) {
      for (var s = 0, r = -1, o = a.length, f; s < o; ++s)
        f = a[s], (!n.type || f.type === n.type) && f.name === n.name ? this.removeEventListener(f.type, f.listener, f.options) : a[++r] = f;
      ++r ? a.length = r : delete this.__on;
    }
  };
}
function aC(n, a, s) {
  return function() {
    var r = this.__on, o, f = tC(a);
    if (r) {
      for (var h = 0, m = r.length; h < m; ++h)
        if ((o = r[h]).type === n.type && o.name === n.name) {
          this.removeEventListener(o.type, o.listener, o.options), this.addEventListener(o.type, o.listener = f, o.options = s), o.value = a;
          return;
        }
    }
    this.addEventListener(n.type, f, s), o = { type: n.type, name: n.name, value: a, listener: f, options: s }, r ? r.push(o) : this.__on = [o];
  };
}
function lC(n, a, s) {
  var r = nC(n + ""), o, f = r.length, h;
  if (arguments.length < 2) {
    var m = this.node().__on;
    if (m) {
      for (var v = 0, y = m.length, g; v < y; ++v)
        for (o = 0, g = m[v]; o < f; ++o)
          if ((h = r[o]).type === g.type && h.name === g.name)
            return g.value;
    }
    return;
  }
  for (m = a ? aC : iC, o = 0; o < f; ++o) this.each(m(r[o], a, s));
  return this;
}
function Mb(n, a, s) {
  var r = Eb(n), o = r.CustomEvent;
  typeof o == "function" ? o = new o(a, s) : (o = r.document.createEvent("Event"), s ? (o.initEvent(a, s.bubbles, s.cancelable), o.detail = s.detail) : o.initEvent(a, !1, !1)), n.dispatchEvent(o);
}
function sC(n, a) {
  return function() {
    return Mb(this, n, a);
  };
}
function rC(n, a) {
  return function() {
    return Mb(this, n, a.apply(this, arguments));
  };
}
function oC(n, a) {
  return this.each((typeof a == "function" ? rC : sC)(n, a));
}
function* cC() {
  for (var n = this._groups, a = 0, s = n.length; a < s; ++a)
    for (var r = n[a], o = 0, f = r.length, h; o < f; ++o)
      (h = r[o]) && (yield h);
}
var zb = [null];
function Wi(n, a) {
  this._groups = n, this._parents = a;
}
function Lc() {
  return new Wi([[document.documentElement]], zb);
}
function uC() {
  return this;
}
Wi.prototype = Lc.prototype = {
  constructor: Wi,
  select: HN,
  selectAll: $N,
  selectChild: IN,
  selectChildren: QN,
  filter: KN,
  data: tT,
  enter: PN,
  exit: iT,
  join: aT,
  merge: lT,
  selection: uC,
  order: sT,
  sort: rT,
  call: cT,
  nodes: uT,
  node: fT,
  size: dT,
  empty: hT,
  each: mT,
  attr: ST,
  style: NT,
  property: MT,
  classed: RT,
  text: LT,
  html: qT,
  raise: YT,
  lower: XT,
  append: GT,
  insert: QT,
  remove: PT,
  clone: WT,
  datum: eC,
  on: lC,
  dispatch: oC,
  [Symbol.iterator]: cC
};
function Fi(n) {
  return typeof n == "string" ? new Wi([[document.querySelector(n)]], [document.documentElement]) : new Wi([[n]], zb);
}
var fC = 0;
function wx() {
  this._ = "@" + (++fC).toString(36);
}
wx.prototype = {
  constructor: wx,
  get: function(n) {
    for (var a = this._; !(a in n); ) if (!(n = n.parentNode)) return;
    return n[a];
  },
  set: function(n, a) {
    return n[this._] = a;
  },
  remove: function(n) {
    return this._ in n && delete n[this._];
  },
  toString: function() {
    return this._;
  }
};
function dC(n) {
  let a;
  for (; a = n.sourceEvent; ) n = a;
  return n;
}
function ka(n, a) {
  if (n = dC(n), a === void 0 && (a = n.currentTarget), a) {
    var s = a.ownerSVGElement || a;
    if (s.createSVGPoint) {
      var r = s.createSVGPoint();
      return r.x = n.clientX, r.y = n.clientY, r = r.matrixTransform(a.getScreenCTM().inverse()), [r.x, r.y];
    }
    if (a.getBoundingClientRect) {
      var o = a.getBoundingClientRect();
      return [n.clientX - o.left - a.clientLeft, n.clientY - o.top - a.clientTop];
    }
  }
  return [n.pageX, n.pageY];
}
const hC = { passive: !1 }, Ac = { capture: !0, passive: !1 };
function Cm(n) {
  n.stopImmediatePropagation();
}
function eo(n) {
  n.preventDefault(), n.stopImmediatePropagation();
}
function kb(n) {
  var a = n.document.documentElement, s = Fi(n).on("dragstart.drag", eo, Ac);
  "onselectstart" in a ? s.on("selectstart.drag", eo, Ac) : (a.__noselect = a.style.MozUserSelect, a.style.MozUserSelect = "none");
}
function jb(n, a) {
  var s = n.document.documentElement, r = Fi(n).on("dragstart.drag", null);
  a && (r.on("click.drag", eo, Ac), setTimeout(function() {
    r.on("click.drag", null);
  }, 0)), "onselectstart" in s ? r.on("selectstart.drag", null) : (s.style.MozUserSelect = s.__noselect, delete s.__noselect);
}
var sf = (n) => () => n;
function op(n, {
  sourceEvent: a,
  subject: s,
  target: r,
  identifier: o,
  active: f,
  x: h,
  y: m,
  dx: v,
  dy: y,
  dispatch: g
}) {
  Object.defineProperties(this, {
    type: { value: n, enumerable: !0, configurable: !0 },
    sourceEvent: { value: a, enumerable: !0, configurable: !0 },
    subject: { value: s, enumerable: !0, configurable: !0 },
    target: { value: r, enumerable: !0, configurable: !0 },
    identifier: { value: o, enumerable: !0, configurable: !0 },
    active: { value: f, enumerable: !0, configurable: !0 },
    x: { value: h, enumerable: !0, configurable: !0 },
    y: { value: m, enumerable: !0, configurable: !0 },
    dx: { value: v, enumerable: !0, configurable: !0 },
    dy: { value: y, enumerable: !0, configurable: !0 },
    _: { value: g }
  });
}
op.prototype.on = function() {
  var n = this._.on.apply(this._, arguments);
  return n === this._ ? this : n;
};
function mC(n) {
  return !n.ctrlKey && !n.button;
}
function pC() {
  return this.parentNode;
}
function gC(n, a) {
  return a ?? { x: n.x, y: n.y };
}
function yC() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function Rb() {
  var n = mC, a = pC, s = gC, r = yC, o = {}, f = Xf("start", "drag", "end"), h = 0, m, v, y, g, p = 0;
  function S(R) {
    R.on("mousedown.drag", w).filter(r).on("touchstart.drag", _).on("touchmove.drag", C, hC).on("touchend.drag touchcancel.drag", D).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  function w(R, Q) {
    if (!(g || !n.call(this, R, Q))) {
      var V = M(this, a.call(this, R, Q), R, Q, "mouse");
      V && (Fi(R.view).on("mousemove.drag", E, Ac).on("mouseup.drag", N, Ac), kb(R.view), Cm(R), y = !1, m = R.clientX, v = R.clientY, V("start", R));
    }
  }
  function E(R) {
    if (eo(R), !y) {
      var Q = R.clientX - m, V = R.clientY - v;
      y = Q * Q + V * V > p;
    }
    o.mouse("drag", R);
  }
  function N(R) {
    Fi(R.view).on("mousemove.drag mouseup.drag", null), jb(R.view, y), eo(R), o.mouse("end", R);
  }
  function _(R, Q) {
    if (n.call(this, R, Q)) {
      var V = R.changedTouches, k = a.call(this, R, Q), H = V.length, q, de;
      for (q = 0; q < H; ++q)
        (de = M(this, k, R, Q, V[q].identifier, V[q])) && (Cm(R), de("start", R, V[q]));
    }
  }
  function C(R) {
    var Q = R.changedTouches, V = Q.length, k, H;
    for (k = 0; k < V; ++k)
      (H = o[Q[k].identifier]) && (eo(R), H("drag", R, Q[k]));
  }
  function D(R) {
    var Q = R.changedTouches, V = Q.length, k, H;
    for (g && clearTimeout(g), g = setTimeout(function() {
      g = null;
    }, 500), k = 0; k < V; ++k)
      (H = o[Q[k].identifier]) && (Cm(R), H("end", R, Q[k]));
  }
  function M(R, Q, V, k, H, q) {
    var de = f.copy(), ee = ka(q || V, Q), me, te, O;
    if ((O = s.call(R, new op("beforestart", {
      sourceEvent: V,
      target: S,
      identifier: H,
      active: h,
      x: ee[0],
      y: ee[1],
      dx: 0,
      dy: 0,
      dispatch: de
    }), k)) != null)
      return me = O.x - ee[0] || 0, te = O.y - ee[1] || 0, function Y(j, B, X) {
        var J = ee, I;
        switch (j) {
          case "start":
            o[H] = Y, I = h++;
            break;
          case "end":
            delete o[H], --h;
          // falls through
          case "drag":
            ee = ka(X || B, Q), I = h;
            break;
        }
        de.call(
          j,
          R,
          new op(j, {
            sourceEvent: B,
            subject: O,
            target: S,
            identifier: H,
            active: I,
            x: ee[0] + me,
            y: ee[1] + te,
            dx: ee[0] - J[0],
            dy: ee[1] - J[1],
            dispatch: de
          }),
          k
        );
      };
  }
  return S.filter = function(R) {
    return arguments.length ? (n = typeof R == "function" ? R : sf(!!R), S) : n;
  }, S.container = function(R) {
    return arguments.length ? (a = typeof R == "function" ? R : sf(R), S) : a;
  }, S.subject = function(R) {
    return arguments.length ? (s = typeof R == "function" ? R : sf(R), S) : s;
  }, S.touchable = function(R) {
    return arguments.length ? (r = typeof R == "function" ? R : sf(!!R), S) : r;
  }, S.on = function() {
    var R = f.on.apply(f, arguments);
    return R === f ? S : R;
  }, S.clickDistance = function(R) {
    return arguments.length ? (p = (R = +R) * R, S) : Math.sqrt(p);
  }, S;
}
function yo(n, a, s) {
  n.prototype = a.prototype = s, s.constructor = n;
}
function Uc(n, a) {
  var s = Object.create(n.prototype);
  for (var r in a) s[r] = a[r];
  return s;
}
function ys() {
}
var Fs = 0.7, ro = 1 / Fs, to = "\\s*([+-]?\\d+)\\s*", Mc = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*", rl = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*", vC = /^#([0-9a-f]{3,8})$/, xC = new RegExp(`^rgb\\(${to},${to},${to}\\)$`), bC = new RegExp(`^rgb\\(${rl},${rl},${rl}\\)$`), SC = new RegExp(`^rgba\\(${to},${to},${to},${Mc}\\)$`), wC = new RegExp(`^rgba\\(${rl},${rl},${rl},${Mc}\\)$`), _C = new RegExp(`^hsl\\(${Mc},${rl},${rl}\\)$`), EC = new RegExp(`^hsla\\(${Mc},${rl},${rl},${Mc}\\)$`), _x = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
yo(ys, Ws, {
  copy(n) {
    return Object.assign(new this.constructor(), this, n);
  },
  displayable() {
    return this.rgb().displayable();
  },
  hex: Ex,
  // Deprecated! Use color.formatHex.
  formatHex: Ex,
  formatHex8: NC,
  formatHsl: TC,
  formatRgb: Nx,
  toString: Nx
});
function Ex() {
  return this.rgb().formatHex();
}
function NC() {
  return this.rgb().formatHex8();
}
function TC() {
  return Ob(this).formatHsl();
}
function Nx() {
  return this.rgb().formatRgb();
}
function Ws(n) {
  var a, s;
  return n = (n + "").trim().toLowerCase(), (a = vC.exec(n)) ? (s = a[1].length, a = parseInt(a[1], 16), s === 6 ? Tx(a) : s === 3 ? new Gn(a >> 8 & 15 | a >> 4 & 240, a >> 4 & 15 | a & 240, (a & 15) << 4 | a & 15, 1) : s === 8 ? rf(a >> 24 & 255, a >> 16 & 255, a >> 8 & 255, (a & 255) / 255) : s === 4 ? rf(a >> 12 & 15 | a >> 8 & 240, a >> 8 & 15 | a >> 4 & 240, a >> 4 & 15 | a & 240, ((a & 15) << 4 | a & 15) / 255) : null) : (a = xC.exec(n)) ? new Gn(a[1], a[2], a[3], 1) : (a = bC.exec(n)) ? new Gn(a[1] * 255 / 100, a[2] * 255 / 100, a[3] * 255 / 100, 1) : (a = SC.exec(n)) ? rf(a[1], a[2], a[3], a[4]) : (a = wC.exec(n)) ? rf(a[1] * 255 / 100, a[2] * 255 / 100, a[3] * 255 / 100, a[4]) : (a = _C.exec(n)) ? Mx(a[1], a[2] / 100, a[3] / 100, 1) : (a = EC.exec(n)) ? Mx(a[1], a[2] / 100, a[3] / 100, a[4]) : _x.hasOwnProperty(n) ? Tx(_x[n]) : n === "transparent" ? new Gn(NaN, NaN, NaN, 0) : null;
}
function Tx(n) {
  return new Gn(n >> 16 & 255, n >> 8 & 255, n & 255, 1);
}
function rf(n, a, s, r) {
  return r <= 0 && (n = a = s = NaN), new Gn(n, a, s, r);
}
function jp(n) {
  return n instanceof ys || (n = Ws(n)), n ? (n = n.rgb(), new Gn(n.r, n.g, n.b, n.opacity)) : new Gn();
}
function cp(n, a, s, r) {
  return arguments.length === 1 ? jp(n) : new Gn(n, a, s, r ?? 1);
}
function Gn(n, a, s, r) {
  this.r = +n, this.g = +a, this.b = +s, this.opacity = +r;
}
yo(Gn, cp, Uc(ys, {
  brighter(n) {
    return n = n == null ? ro : Math.pow(ro, n), new Gn(this.r * n, this.g * n, this.b * n, this.opacity);
  },
  darker(n) {
    return n = n == null ? Fs : Math.pow(Fs, n), new Gn(this.r * n, this.g * n, this.b * n, this.opacity);
  },
  rgb() {
    return this;
  },
  clamp() {
    return new Gn(Ks(this.r), Ks(this.g), Ks(this.b), zf(this.opacity));
  },
  displayable() {
    return -0.5 <= this.r && this.r < 255.5 && -0.5 <= this.g && this.g < 255.5 && -0.5 <= this.b && this.b < 255.5 && 0 <= this.opacity && this.opacity <= 1;
  },
  hex: Cx,
  // Deprecated! Use color.formatHex.
  formatHex: Cx,
  formatHex8: CC,
  formatRgb: Ax,
  toString: Ax
}));
function Cx() {
  return `#${Zs(this.r)}${Zs(this.g)}${Zs(this.b)}`;
}
function CC() {
  return `#${Zs(this.r)}${Zs(this.g)}${Zs(this.b)}${Zs((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}
function Ax() {
  const n = zf(this.opacity);
  return `${n === 1 ? "rgb(" : "rgba("}${Ks(this.r)}, ${Ks(this.g)}, ${Ks(this.b)}${n === 1 ? ")" : `, ${n})`}`;
}
function zf(n) {
  return isNaN(n) ? 1 : Math.max(0, Math.min(1, n));
}
function Ks(n) {
  return Math.max(0, Math.min(255, Math.round(n) || 0));
}
function Zs(n) {
  return n = Ks(n), (n < 16 ? "0" : "") + n.toString(16);
}
function Mx(n, a, s, r) {
  return r <= 0 ? n = a = s = NaN : s <= 0 || s >= 1 ? n = a = NaN : a <= 0 && (n = NaN), new Oa(n, a, s, r);
}
function Ob(n) {
  if (n instanceof Oa) return new Oa(n.h, n.s, n.l, n.opacity);
  if (n instanceof ys || (n = Ws(n)), !n) return new Oa();
  if (n instanceof Oa) return n;
  n = n.rgb();
  var a = n.r / 255, s = n.g / 255, r = n.b / 255, o = Math.min(a, s, r), f = Math.max(a, s, r), h = NaN, m = f - o, v = (f + o) / 2;
  return m ? (a === f ? h = (s - r) / m + (s < r) * 6 : s === f ? h = (r - a) / m + 2 : h = (a - s) / m + 4, m /= v < 0.5 ? f + o : 2 - f - o, h *= 60) : m = v > 0 && v < 1 ? 0 : h, new Oa(h, m, v, n.opacity);
}
function AC(n, a, s, r) {
  return arguments.length === 1 ? Ob(n) : new Oa(n, a, s, r ?? 1);
}
function Oa(n, a, s, r) {
  this.h = +n, this.s = +a, this.l = +s, this.opacity = +r;
}
yo(Oa, AC, Uc(ys, {
  brighter(n) {
    return n = n == null ? ro : Math.pow(ro, n), new Oa(this.h, this.s, this.l * n, this.opacity);
  },
  darker(n) {
    return n = n == null ? Fs : Math.pow(Fs, n), new Oa(this.h, this.s, this.l * n, this.opacity);
  },
  rgb() {
    var n = this.h % 360 + (this.h < 0) * 360, a = isNaN(n) || isNaN(this.s) ? 0 : this.s, s = this.l, r = s + (s < 0.5 ? s : 1 - s) * a, o = 2 * s - r;
    return new Gn(
      Am(n >= 240 ? n - 240 : n + 120, o, r),
      Am(n, o, r),
      Am(n < 120 ? n + 240 : n - 120, o, r),
      this.opacity
    );
  },
  clamp() {
    return new Oa(zx(this.h), of(this.s), of(this.l), zf(this.opacity));
  },
  displayable() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && 0 <= this.l && this.l <= 1 && 0 <= this.opacity && this.opacity <= 1;
  },
  formatHsl() {
    const n = zf(this.opacity);
    return `${n === 1 ? "hsl(" : "hsla("}${zx(this.h)}, ${of(this.s) * 100}%, ${of(this.l) * 100}%${n === 1 ? ")" : `, ${n})`}`;
  }
}));
function zx(n) {
  return n = (n || 0) % 360, n < 0 ? n + 360 : n;
}
function of(n) {
  return Math.max(0, Math.min(1, n || 0));
}
function Am(n, a, s) {
  return (n < 60 ? a + (s - a) * n / 60 : n < 180 ? s : n < 240 ? a + (s - a) * (240 - n) / 60 : a) * 255;
}
const Db = Math.PI / 180, Hb = 180 / Math.PI, kf = 18, Lb = 0.96422, Ub = 1, Bb = 0.82521, $b = 4 / 29, no = 6 / 29, qb = 3 * no * no, MC = no * no * no;
function Vb(n) {
  if (n instanceof ol) return new ol(n.l, n.a, n.b, n.opacity);
  if (n instanceof kl) return Yb(n);
  n instanceof Gn || (n = jp(n));
  var a = jm(n.r), s = jm(n.g), r = jm(n.b), o = Mm((0.2225045 * a + 0.7168786 * s + 0.0606169 * r) / Ub), f, h;
  return a === s && s === r ? f = h = o : (f = Mm((0.4360747 * a + 0.3850649 * s + 0.1430804 * r) / Lb), h = Mm((0.0139322 * a + 0.0971045 * s + 0.7141733 * r) / Bb)), new ol(116 * o - 16, 500 * (f - o), 200 * (o - h), n.opacity);
}
function zC(n, a, s, r) {
  return arguments.length === 1 ? Vb(n) : new ol(n, a, s, r ?? 1);
}
function ol(n, a, s, r) {
  this.l = +n, this.a = +a, this.b = +s, this.opacity = +r;
}
yo(ol, zC, Uc(ys, {
  brighter(n) {
    return new ol(this.l + kf * (n ?? 1), this.a, this.b, this.opacity);
  },
  darker(n) {
    return new ol(this.l - kf * (n ?? 1), this.a, this.b, this.opacity);
  },
  rgb() {
    var n = (this.l + 16) / 116, a = isNaN(this.a) ? n : n + this.a / 500, s = isNaN(this.b) ? n : n - this.b / 200;
    return a = Lb * zm(a), n = Ub * zm(n), s = Bb * zm(s), new Gn(
      km(3.1338561 * a - 1.6168667 * n - 0.4906146 * s),
      km(-0.9787684 * a + 1.9161415 * n + 0.033454 * s),
      km(0.0719453 * a - 0.2289914 * n + 1.4052427 * s),
      this.opacity
    );
  }
}));
function Mm(n) {
  return n > MC ? Math.pow(n, 1 / 3) : n / qb + $b;
}
function zm(n) {
  return n > no ? n * n * n : qb * (n - $b);
}
function km(n) {
  return 255 * (n <= 31308e-7 ? 12.92 * n : 1.055 * Math.pow(n, 1 / 2.4) - 0.055);
}
function jm(n) {
  return (n /= 255) <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}
function kC(n) {
  if (n instanceof kl) return new kl(n.h, n.c, n.l, n.opacity);
  if (n instanceof ol || (n = Vb(n)), n.a === 0 && n.b === 0) return new kl(NaN, 0 < n.l && n.l < 100 ? 0 : NaN, n.l, n.opacity);
  var a = Math.atan2(n.b, n.a) * Hb;
  return new kl(a < 0 ? a + 360 : a, Math.sqrt(n.a * n.a + n.b * n.b), n.l, n.opacity);
}
function jC(n, a, s, r) {
  return arguments.length === 1 ? kC(n) : new kl(n, a, s, r ?? 1);
}
function kl(n, a, s, r) {
  this.h = +n, this.c = +a, this.l = +s, this.opacity = +r;
}
function Yb(n) {
  if (isNaN(n.h)) return new ol(n.l, 0, 0, n.opacity);
  var a = n.h * Db;
  return new ol(n.l, Math.cos(a) * n.c, Math.sin(a) * n.c, n.opacity);
}
yo(kl, jC, Uc(ys, {
  brighter(n) {
    return new kl(this.h, this.c, this.l + kf * (n ?? 1), this.opacity);
  },
  darker(n) {
    return new kl(this.h, this.c, this.l - kf * (n ?? 1), this.opacity);
  },
  rgb() {
    return Yb(this).rgb();
  }
}));
var Ib = -0.14861, Rp = 1.78277, Op = -0.29227, Zf = -0.90649, zc = 1.97294, kx = zc * Zf, jx = zc * Rp, Rx = Rp * Op - Zf * Ib;
function RC(n) {
  if (n instanceof Ps) return new Ps(n.h, n.s, n.l, n.opacity);
  n instanceof Gn || (n = jp(n));
  var a = n.r / 255, s = n.g / 255, r = n.b / 255, o = (Rx * r + kx * a - jx * s) / (Rx + kx - jx), f = r - o, h = (zc * (s - o) - Op * f) / Zf, m = Math.sqrt(h * h + f * f) / (zc * o * (1 - o)), v = m ? Math.atan2(h, f) * Hb - 120 : NaN;
  return new Ps(v < 0 ? v + 360 : v, m, o, n.opacity);
}
function up(n, a, s, r) {
  return arguments.length === 1 ? RC(n) : new Ps(n, a, s, r ?? 1);
}
function Ps(n, a, s, r) {
  this.h = +n, this.s = +a, this.l = +s, this.opacity = +r;
}
yo(Ps, up, Uc(ys, {
  brighter(n) {
    return n = n == null ? ro : Math.pow(ro, n), new Ps(this.h, this.s, this.l * n, this.opacity);
  },
  darker(n) {
    return n = n == null ? Fs : Math.pow(Fs, n), new Ps(this.h, this.s, this.l * n, this.opacity);
  },
  rgb() {
    var n = isNaN(this.h) ? 0 : (this.h + 120) * Db, a = +this.l, s = isNaN(this.s) ? 0 : this.s * a * (1 - a), r = Math.cos(n), o = Math.sin(n);
    return new Gn(
      255 * (a + s * (Ib * r + Rp * o)),
      255 * (a + s * (Op * r + Zf * o)),
      255 * (a + s * (zc * r)),
      this.opacity
    );
  }
}));
var Qf = (n) => () => n;
function Xb(n, a) {
  return function(s) {
    return n + s * a;
  };
}
function OC(n, a, s) {
  return n = Math.pow(n, s), a = Math.pow(a, s) - n, s = 1 / s, function(r) {
    return Math.pow(n + r * a, s);
  };
}
function DC(n, a) {
  var s = a - n;
  return s ? Xb(n, s > 180 || s < -180 ? s - 360 * Math.round(s / 360) : s) : Qf(isNaN(n) ? a : n);
}
function HC(n) {
  return (n = +n) == 1 ? io : function(a, s) {
    return s - a ? OC(a, s, n) : Qf(isNaN(a) ? s : a);
  };
}
function io(n, a) {
  var s = a - n;
  return s ? Xb(n, s) : Qf(isNaN(n) ? a : n);
}
var jf = (function n(a) {
  var s = HC(a);
  function r(o, f) {
    var h = s((o = cp(o)).r, (f = cp(f)).r), m = s(o.g, f.g), v = s(o.b, f.b), y = io(o.opacity, f.opacity);
    return function(g) {
      return o.r = h(g), o.g = m(g), o.b = v(g), o.opacity = y(g), o + "";
    };
  }
  return r.gamma = n, r;
})(1);
function LC(n, a) {
  a || (a = []);
  var s = n ? Math.min(a.length, n.length) : 0, r = a.slice(), o;
  return function(f) {
    for (o = 0; o < s; ++o) r[o] = n[o] * (1 - f) + a[o] * f;
    return r;
  };
}
function UC(n) {
  return ArrayBuffer.isView(n) && !(n instanceof DataView);
}
function BC(n, a) {
  var s = a ? a.length : 0, r = n ? Math.min(s, n.length) : 0, o = new Array(r), f = new Array(s), h;
  for (h = 0; h < r; ++h) o[h] = Nc(n[h], a[h]);
  for (; h < s; ++h) f[h] = a[h];
  return function(m) {
    for (h = 0; h < r; ++h) f[h] = o[h](m);
    return f;
  };
}
function $C(n, a) {
  var s = /* @__PURE__ */ new Date();
  return n = +n, a = +a, function(r) {
    return s.setTime(n * (1 - r) + a * r), s;
  };
}
function ll(n, a) {
  return n = +n, a = +a, function(s) {
    return n * (1 - s) + a * s;
  };
}
function qC(n, a) {
  var s = {}, r = {}, o;
  (n === null || typeof n != "object") && (n = {}), (a === null || typeof a != "object") && (a = {});
  for (o in a)
    o in n ? s[o] = Nc(n[o], a[o]) : r[o] = a[o];
  return function(f) {
    for (o in s) r[o] = s[o](f);
    return r;
  };
}
var fp = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g, Rm = new RegExp(fp.source, "g");
function VC(n) {
  return function() {
    return n;
  };
}
function YC(n) {
  return function(a) {
    return n(a) + "";
  };
}
function Gb(n, a) {
  var s = fp.lastIndex = Rm.lastIndex = 0, r, o, f, h = -1, m = [], v = [];
  for (n = n + "", a = a + ""; (r = fp.exec(n)) && (o = Rm.exec(a)); )
    (f = o.index) > s && (f = a.slice(s, f), m[h] ? m[h] += f : m[++h] = f), (r = r[0]) === (o = o[0]) ? m[h] ? m[h] += o : m[++h] = o : (m[++h] = null, v.push({ i: h, x: ll(r, o) })), s = Rm.lastIndex;
  return s < a.length && (f = a.slice(s), m[h] ? m[h] += f : m[++h] = f), m.length < 2 ? v[0] ? YC(v[0].x) : VC(a) : (a = v.length, function(y) {
    for (var g = 0, p; g < a; ++g) m[(p = v[g]).i] = p.x(y);
    return m.join("");
  });
}
function Nc(n, a) {
  var s = typeof a, r;
  return a == null || s === "boolean" ? Qf(a) : (s === "number" ? ll : s === "string" ? (r = Ws(a)) ? (a = r, jf) : Gb : a instanceof Ws ? jf : a instanceof Date ? $C : UC(a) ? LC : Array.isArray(a) ? BC : typeof a.valueOf != "function" && typeof a.toString != "function" || isNaN(a) ? qC : ll)(n, a);
}
var Ox = 180 / Math.PI, dp = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  skewX: 0,
  scaleX: 1,
  scaleY: 1
};
function Zb(n, a, s, r, o, f) {
  var h, m, v;
  return (h = Math.sqrt(n * n + a * a)) && (n /= h, a /= h), (v = n * s + a * r) && (s -= n * v, r -= a * v), (m = Math.sqrt(s * s + r * r)) && (s /= m, r /= m, v /= m), n * r < a * s && (n = -n, a = -a, v = -v, h = -h), {
    translateX: o,
    translateY: f,
    rotate: Math.atan2(a, n) * Ox,
    skewX: Math.atan(v) * Ox,
    scaleX: h,
    scaleY: m
  };
}
var cf;
function IC(n) {
  const a = new (typeof DOMMatrix == "function" ? DOMMatrix : WebKitCSSMatrix)(n + "");
  return a.isIdentity ? dp : Zb(a.a, a.b, a.c, a.d, a.e, a.f);
}
function XC(n) {
  return n == null || (cf || (cf = document.createElementNS("http://www.w3.org/2000/svg", "g")), cf.setAttribute("transform", n), !(n = cf.transform.baseVal.consolidate())) ? dp : (n = n.matrix, Zb(n.a, n.b, n.c, n.d, n.e, n.f));
}
function Qb(n, a, s, r) {
  function o(y) {
    return y.length ? y.pop() + " " : "";
  }
  function f(y, g, p, S, w, E) {
    if (y !== p || g !== S) {
      var N = w.push("translate(", null, a, null, s);
      E.push({ i: N - 4, x: ll(y, p) }, { i: N - 2, x: ll(g, S) });
    } else (p || S) && w.push("translate(" + p + a + S + s);
  }
  function h(y, g, p, S) {
    y !== g ? (y - g > 180 ? g += 360 : g - y > 180 && (y += 360), S.push({ i: p.push(o(p) + "rotate(", null, r) - 2, x: ll(y, g) })) : g && p.push(o(p) + "rotate(" + g + r);
  }
  function m(y, g, p, S) {
    y !== g ? S.push({ i: p.push(o(p) + "skewX(", null, r) - 2, x: ll(y, g) }) : g && p.push(o(p) + "skewX(" + g + r);
  }
  function v(y, g, p, S, w, E) {
    if (y !== p || g !== S) {
      var N = w.push(o(w) + "scale(", null, ",", null, ")");
      E.push({ i: N - 4, x: ll(y, p) }, { i: N - 2, x: ll(g, S) });
    } else (p !== 1 || S !== 1) && w.push(o(w) + "scale(" + p + "," + S + ")");
  }
  return function(y, g) {
    var p = [], S = [];
    return y = n(y), g = n(g), f(y.translateX, y.translateY, g.translateX, g.translateY, p, S), h(y.rotate, g.rotate, p, S), m(y.skewX, g.skewX, p, S), v(y.scaleX, y.scaleY, g.scaleX, g.scaleY, p, S), y = g = null, function(w) {
      for (var E = -1, N = S.length, _; ++E < N; ) p[(_ = S[E]).i] = _.x(w);
      return p.join("");
    };
  };
}
var GC = Qb(IC, "px, ", "px)", "deg)"), ZC = Qb(XC, ", ", ")", ")"), QC = 1e-12;
function Dx(n) {
  return ((n = Math.exp(n)) + 1 / n) / 2;
}
function KC(n) {
  return ((n = Math.exp(n)) - 1 / n) / 2;
}
function PC(n) {
  return ((n = Math.exp(2 * n)) - 1) / (n + 1);
}
var Sf = (function n(a, s, r) {
  function o(f, h) {
    var m = f[0], v = f[1], y = f[2], g = h[0], p = h[1], S = h[2], w = g - m, E = p - v, N = w * w + E * E, _, C;
    if (N < QC)
      C = Math.log(S / y) / a, _ = function(k) {
        return [
          m + k * w,
          v + k * E,
          y * Math.exp(a * k * C)
        ];
      };
    else {
      var D = Math.sqrt(N), M = (S * S - y * y + r * N) / (2 * y * s * D), R = (S * S - y * y - r * N) / (2 * S * s * D), Q = Math.log(Math.sqrt(M * M + 1) - M), V = Math.log(Math.sqrt(R * R + 1) - R);
      C = (V - Q) / a, _ = function(k) {
        var H = k * C, q = Dx(Q), de = y / (s * D) * (q * PC(a * H + Q) - KC(Q));
        return [
          m + de * w,
          v + de * E,
          y * q / Dx(a * H + Q)
        ];
      };
    }
    return _.duration = Math.abs(C) * 1e3 * a / Math.SQRT2, _;
  }
  return o.rho = function(f) {
    var h = Math.max(1e-3, +f), m = h * h, v = m * m;
    return n(h, m, v);
  }, o;
})(Math.SQRT2, 2, 4);
function Kb(n) {
  return (function a(s) {
    s = +s;
    function r(o, f) {
      var h = n((o = up(o)).h, (f = up(f)).h), m = io(o.s, f.s), v = io(o.l, f.l), y = io(o.opacity, f.opacity);
      return function(g) {
        return o.h = h(g), o.s = m(g), o.l = v(Math.pow(g, s)), o.opacity = y(g), o + "";
      };
    }
    return r.gamma = a, r;
  })(1);
}
Kb(DC);
Kb(io);
var oo = 0, vc = 0, oc = 0, Pb = 1e3, Rf, xc, Of = 0, er = 0, Kf = 0, kc = typeof performance == "object" && performance.now ? performance : Date, Jb = typeof window == "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(n) {
  setTimeout(n, 17);
};
function Dp() {
  return er || (Jb(JC), er = kc.now() + Kf);
}
function JC() {
  er = 0;
}
function Df() {
  this._call = this._time = this._next = null;
}
Df.prototype = Fb.prototype = {
  constructor: Df,
  restart: function(n, a, s) {
    if (typeof n != "function") throw new TypeError("callback is not a function");
    s = (s == null ? Dp() : +s) + (a == null ? 0 : +a), !this._next && xc !== this && (xc ? xc._next = this : Rf = this, xc = this), this._call = n, this._time = s, hp();
  },
  stop: function() {
    this._call && (this._call = null, this._time = 1 / 0, hp());
  }
};
function Fb(n, a, s) {
  var r = new Df();
  return r.restart(n, a, s), r;
}
function FC() {
  Dp(), ++oo;
  for (var n = Rf, a; n; )
    (a = er - n._time) >= 0 && n._call.call(void 0, a), n = n._next;
  --oo;
}
function Hx() {
  er = (Of = kc.now()) + Kf, oo = vc = 0;
  try {
    FC();
  } finally {
    oo = 0, e3(), er = 0;
  }
}
function WC() {
  var n = kc.now(), a = n - Of;
  a > Pb && (Kf -= a, Of = n);
}
function e3() {
  for (var n, a = Rf, s, r = 1 / 0; a; )
    a._call ? (r > a._time && (r = a._time), n = a, a = a._next) : (s = a._next, a._next = null, a = n ? n._next = s : Rf = s);
  xc = n, hp(r);
}
function hp(n) {
  if (!oo) {
    vc && (vc = clearTimeout(vc));
    var a = n - er;
    a > 24 ? (n < 1 / 0 && (vc = setTimeout(Hx, Math.ceil(n - kc.now() - Kf) + 1)), oc && (oc = clearInterval(oc))) : (oc || (Of = kc.now(), oc = setInterval(WC, Pb)), oo = 1, Jb(Hx));
  }
}
function Lx(n, a, s) {
  var r = new Df();
  return a = a == null ? 0 : +a, r.restart((o) => {
    r.stop(), n(o + a);
  }, a, s), r;
}
function t3(n) {
  return ((n *= 2) <= 1 ? n * n * n : (n -= 2) * n * n + 2) / 2;
}
var Hp = 3;
(function n(a) {
  a = +a;
  function s(r) {
    return Math.pow(r, a);
  }
  return s.exponent = n, s;
})(Hp);
(function n(a) {
  a = +a;
  function s(r) {
    return 1 - Math.pow(1 - r, a);
  }
  return s.exponent = n, s;
})(Hp);
(function n(a) {
  a = +a;
  function s(r) {
    return ((r *= 2) <= 1 ? Math.pow(r, a) : 2 - Math.pow(2 - r, a)) / 2;
  }
  return s.exponent = n, s;
})(Hp);
function Hf(n) {
  return (Math.pow(2, -10 * n) - 9765625e-10) * 1.0009775171065494;
}
var Lp = 1.70158;
(function n(a) {
  a = +a;
  function s(r) {
    return (r = +r) * r * (a * (r - 1) + r);
  }
  return s.overshoot = n, s;
})(Lp);
(function n(a) {
  a = +a;
  function s(r) {
    return --r * r * ((r + 1) * a + r) + 1;
  }
  return s.overshoot = n, s;
})(Lp);
(function n(a) {
  a = +a;
  function s(r) {
    return ((r *= 2) < 1 ? r * r * ((a + 1) * r - a) : (r -= 2) * r * ((a + 1) * r + a) + 2) / 2;
  }
  return s.overshoot = n, s;
})(Lp);
var co = 2 * Math.PI, Up = 1, Bp = 0.3;
(function n(a, s) {
  var r = Math.asin(1 / (a = Math.max(1, a))) * (s /= co);
  function o(f) {
    return a * Hf(- --f) * Math.sin((r - f) / s);
  }
  return o.amplitude = function(f) {
    return n(f, s * co);
  }, o.period = function(f) {
    return n(a, f);
  }, o;
})(Up, Bp);
(function n(a, s) {
  var r = Math.asin(1 / (a = Math.max(1, a))) * (s /= co);
  function o(f) {
    return 1 - a * Hf(f = +f) * Math.sin((f + r) / s);
  }
  return o.amplitude = function(f) {
    return n(f, s * co);
  }, o.period = function(f) {
    return n(a, f);
  }, o;
})(Up, Bp);
(function n(a, s) {
  var r = Math.asin(1 / (a = Math.max(1, a))) * (s /= co);
  function o(f) {
    return ((f = f * 2 - 1) < 0 ? a * Hf(-f) * Math.sin((r - f) / s) : 2 - a * Hf(f) * Math.sin((r + f) / s)) / 2;
  }
  return o.amplitude = function(f) {
    return n(f, s * co);
  }, o.period = function(f) {
    return n(a, f);
  }, o;
})(Up, Bp);
var n3 = Xf("start", "end", "cancel", "interrupt"), i3 = [], Wb = 0, Ux = 1, mp = 2, wf = 3, Bx = 4, pp = 5, _f = 6;
function Pf(n, a, s, r, o, f) {
  var h = n.__transition;
  if (!h) n.__transition = {};
  else if (s in h) return;
  a3(n, s, {
    name: a,
    index: r,
    // For context during callback.
    group: o,
    // For context during callback.
    on: n3,
    tween: i3,
    time: f.time,
    delay: f.delay,
    duration: f.duration,
    ease: f.ease,
    timer: null,
    state: Wb
  });
}
function $p(n, a) {
  var s = Ba(n, a);
  if (s.state > Wb) throw new Error("too late; already scheduled");
  return s;
}
function ul(n, a) {
  var s = Ba(n, a);
  if (s.state > wf) throw new Error("too late; already running");
  return s;
}
function Ba(n, a) {
  var s = n.__transition;
  if (!s || !(s = s[a])) throw new Error("transition not found");
  return s;
}
function a3(n, a, s) {
  var r = n.__transition, o;
  r[a] = s, s.timer = Fb(f, 0, s.time);
  function f(y) {
    s.state = Ux, s.timer.restart(h, s.delay, s.time), s.delay <= y && h(y - s.delay);
  }
  function h(y) {
    var g, p, S, w;
    if (s.state !== Ux) return v();
    for (g in r)
      if (w = r[g], w.name === s.name) {
        if (w.state === wf) return Lx(h);
        w.state === Bx ? (w.state = _f, w.timer.stop(), w.on.call("interrupt", n, n.__data__, w.index, w.group), delete r[g]) : +g < a && (w.state = _f, w.timer.stop(), w.on.call("cancel", n, n.__data__, w.index, w.group), delete r[g]);
      }
    if (Lx(function() {
      s.state === wf && (s.state = Bx, s.timer.restart(m, s.delay, s.time), m(y));
    }), s.state = mp, s.on.call("start", n, n.__data__, s.index, s.group), s.state === mp) {
      for (s.state = wf, o = new Array(S = s.tween.length), g = 0, p = -1; g < S; ++g)
        (w = s.tween[g].value.call(n, n.__data__, s.index, s.group)) && (o[++p] = w);
      o.length = p + 1;
    }
  }
  function m(y) {
    for (var g = y < s.duration ? s.ease.call(null, y / s.duration) : (s.timer.restart(v), s.state = pp, 1), p = -1, S = o.length; ++p < S; )
      o[p].call(n, g);
    s.state === pp && (s.on.call("end", n, n.__data__, s.index, s.group), v());
  }
  function v() {
    s.state = _f, s.timer.stop(), delete r[a];
    for (var y in r) return;
    delete n.__transition;
  }
}
function Ef(n, a) {
  var s = n.__transition, r, o, f = !0, h;
  if (s) {
    a = a == null ? null : a + "";
    for (h in s) {
      if ((r = s[h]).name !== a) {
        f = !1;
        continue;
      }
      o = r.state > mp && r.state < pp, r.state = _f, r.timer.stop(), r.on.call(o ? "interrupt" : "cancel", n, n.__data__, r.index, r.group), delete s[h];
    }
    f && delete n.__transition;
  }
}
function l3(n) {
  return this.each(function() {
    Ef(this, n);
  });
}
function s3(n, a) {
  var s, r;
  return function() {
    var o = ul(this, n), f = o.tween;
    if (f !== s) {
      r = s = f;
      for (var h = 0, m = r.length; h < m; ++h)
        if (r[h].name === a) {
          r = r.slice(), r.splice(h, 1);
          break;
        }
    }
    o.tween = r;
  };
}
function r3(n, a, s) {
  var r, o;
  if (typeof s != "function") throw new Error();
  return function() {
    var f = ul(this, n), h = f.tween;
    if (h !== r) {
      o = (r = h).slice();
      for (var m = { name: a, value: s }, v = 0, y = o.length; v < y; ++v)
        if (o[v].name === a) {
          o[v] = m;
          break;
        }
      v === y && o.push(m);
    }
    f.tween = o;
  };
}
function o3(n, a) {
  var s = this._id;
  if (n += "", arguments.length < 2) {
    for (var r = Ba(this.node(), s).tween, o = 0, f = r.length, h; o < f; ++o)
      if ((h = r[o]).name === n)
        return h.value;
    return null;
  }
  return this.each((a == null ? s3 : r3)(s, n, a));
}
function qp(n, a, s) {
  var r = n._id;
  return n.each(function() {
    var o = ul(this, r);
    (o.value || (o.value = {}))[a] = s.apply(this, arguments);
  }), function(o) {
    return Ba(o, r).value[a];
  };
}
function eS(n, a) {
  var s;
  return (typeof a == "number" ? ll : a instanceof Ws ? jf : (s = Ws(a)) ? (a = s, jf) : Gb)(n, a);
}
function c3(n) {
  return function() {
    this.removeAttribute(n);
  };
}
function u3(n) {
  return function() {
    this.removeAttributeNS(n.space, n.local);
  };
}
function f3(n, a, s) {
  var r, o = s + "", f;
  return function() {
    var h = this.getAttribute(n);
    return h === o ? null : h === r ? f : f = a(r = h, s);
  };
}
function d3(n, a, s) {
  var r, o = s + "", f;
  return function() {
    var h = this.getAttributeNS(n.space, n.local);
    return h === o ? null : h === r ? f : f = a(r = h, s);
  };
}
function h3(n, a, s) {
  var r, o, f;
  return function() {
    var h, m = s(this), v;
    return m == null ? void this.removeAttribute(n) : (h = this.getAttribute(n), v = m + "", h === v ? null : h === r && v === o ? f : (o = v, f = a(r = h, m)));
  };
}
function m3(n, a, s) {
  var r, o, f;
  return function() {
    var h, m = s(this), v;
    return m == null ? void this.removeAttributeNS(n.space, n.local) : (h = this.getAttributeNS(n.space, n.local), v = m + "", h === v ? null : h === r && v === o ? f : (o = v, f = a(r = h, m)));
  };
}
function p3(n, a) {
  var s = Gf(n), r = s === "transform" ? ZC : eS;
  return this.attrTween(n, typeof a == "function" ? (s.local ? m3 : h3)(s, r, qp(this, "attr." + n, a)) : a == null ? (s.local ? u3 : c3)(s) : (s.local ? d3 : f3)(s, r, a));
}
function g3(n, a) {
  return function(s) {
    this.setAttribute(n, a.call(this, s));
  };
}
function y3(n, a) {
  return function(s) {
    this.setAttributeNS(n.space, n.local, a.call(this, s));
  };
}
function v3(n, a) {
  var s, r;
  function o() {
    var f = a.apply(this, arguments);
    return f !== r && (s = (r = f) && y3(n, f)), s;
  }
  return o._value = a, o;
}
function x3(n, a) {
  var s, r;
  function o() {
    var f = a.apply(this, arguments);
    return f !== r && (s = (r = f) && g3(n, f)), s;
  }
  return o._value = a, o;
}
function b3(n, a) {
  var s = "attr." + n;
  if (arguments.length < 2) return (s = this.tween(s)) && s._value;
  if (a == null) return this.tween(s, null);
  if (typeof a != "function") throw new Error();
  var r = Gf(n);
  return this.tween(s, (r.local ? v3 : x3)(r, a));
}
function S3(n, a) {
  return function() {
    $p(this, n).delay = +a.apply(this, arguments);
  };
}
function w3(n, a) {
  return a = +a, function() {
    $p(this, n).delay = a;
  };
}
function _3(n) {
  var a = this._id;
  return arguments.length ? this.each((typeof n == "function" ? S3 : w3)(a, n)) : Ba(this.node(), a).delay;
}
function E3(n, a) {
  return function() {
    ul(this, n).duration = +a.apply(this, arguments);
  };
}
function N3(n, a) {
  return a = +a, function() {
    ul(this, n).duration = a;
  };
}
function T3(n) {
  var a = this._id;
  return arguments.length ? this.each((typeof n == "function" ? E3 : N3)(a, n)) : Ba(this.node(), a).duration;
}
function C3(n, a) {
  if (typeof a != "function") throw new Error();
  return function() {
    ul(this, n).ease = a;
  };
}
function A3(n) {
  var a = this._id;
  return arguments.length ? this.each(C3(a, n)) : Ba(this.node(), a).ease;
}
function M3(n, a) {
  return function() {
    var s = a.apply(this, arguments);
    if (typeof s != "function") throw new Error();
    ul(this, n).ease = s;
  };
}
function z3(n) {
  if (typeof n != "function") throw new Error();
  return this.each(M3(this._id, n));
}
function k3(n) {
  typeof n != "function" && (n = Sb(n));
  for (var a = this._groups, s = a.length, r = new Array(s), o = 0; o < s; ++o)
    for (var f = a[o], h = f.length, m = r[o] = [], v, y = 0; y < h; ++y)
      (v = f[y]) && n.call(v, v.__data__, y, f) && m.push(v);
  return new Rl(r, this._parents, this._name, this._id);
}
function j3(n) {
  if (n._id !== this._id) throw new Error();
  for (var a = this._groups, s = n._groups, r = a.length, o = s.length, f = Math.min(r, o), h = new Array(r), m = 0; m < f; ++m)
    for (var v = a[m], y = s[m], g = v.length, p = h[m] = new Array(g), S, w = 0; w < g; ++w)
      (S = v[w] || y[w]) && (p[w] = S);
  for (; m < r; ++m)
    h[m] = a[m];
  return new Rl(h, this._parents, this._name, this._id);
}
function R3(n) {
  return (n + "").trim().split(/^|\s+/).every(function(a) {
    var s = a.indexOf(".");
    return s >= 0 && (a = a.slice(0, s)), !a || a === "start";
  });
}
function O3(n, a, s) {
  var r, o, f = R3(a) ? $p : ul;
  return function() {
    var h = f(this, n), m = h.on;
    m !== r && (o = (r = m).copy()).on(a, s), h.on = o;
  };
}
function D3(n, a) {
  var s = this._id;
  return arguments.length < 2 ? Ba(this.node(), s).on.on(n) : this.each(O3(s, n, a));
}
function H3(n) {
  return function() {
    var a = this.parentNode;
    for (var s in this.__transition) if (+s !== n) return;
    a && a.removeChild(this);
  };
}
function L3() {
  return this.on("end.remove", H3(this._id));
}
function U3(n) {
  var a = this._name, s = this._id;
  typeof n != "function" && (n = zp(n));
  for (var r = this._groups, o = r.length, f = new Array(o), h = 0; h < o; ++h)
    for (var m = r[h], v = m.length, y = f[h] = new Array(v), g, p, S = 0; S < v; ++S)
      (g = m[S]) && (p = n.call(g, g.__data__, S, m)) && ("__data__" in g && (p.__data__ = g.__data__), y[S] = p, Pf(y[S], a, s, S, y, Ba(g, s)));
  return new Rl(f, this._parents, a, s);
}
function B3(n) {
  var a = this._name, s = this._id;
  typeof n != "function" && (n = bb(n));
  for (var r = this._groups, o = r.length, f = [], h = [], m = 0; m < o; ++m)
    for (var v = r[m], y = v.length, g, p = 0; p < y; ++p)
      if (g = v[p]) {
        for (var S = n.call(g, g.__data__, p, v), w, E = Ba(g, s), N = 0, _ = S.length; N < _; ++N)
          (w = S[N]) && Pf(w, a, s, N, S, E);
        f.push(S), h.push(g);
      }
  return new Rl(f, h, a, s);
}
var $3 = Lc.prototype.constructor;
function q3() {
  return new $3(this._groups, this._parents);
}
function V3(n, a) {
  var s, r, o;
  return function() {
    var f = so(this, n), h = (this.style.removeProperty(n), so(this, n));
    return f === h ? null : f === s && h === r ? o : o = a(s = f, r = h);
  };
}
function tS(n) {
  return function() {
    this.style.removeProperty(n);
  };
}
function Y3(n, a, s) {
  var r, o = s + "", f;
  return function() {
    var h = so(this, n);
    return h === o ? null : h === r ? f : f = a(r = h, s);
  };
}
function I3(n, a, s) {
  var r, o, f;
  return function() {
    var h = so(this, n), m = s(this), v = m + "";
    return m == null && (v = m = (this.style.removeProperty(n), so(this, n))), h === v ? null : h === r && v === o ? f : (o = v, f = a(r = h, m));
  };
}
function X3(n, a) {
  var s, r, o, f = "style." + a, h = "end." + f, m;
  return function() {
    var v = ul(this, n), y = v.on, g = v.value[f] == null ? m || (m = tS(a)) : void 0;
    (y !== s || o !== g) && (r = (s = y).copy()).on(h, o = g), v.on = r;
  };
}
function G3(n, a, s) {
  var r = (n += "") == "transform" ? GC : eS;
  return a == null ? this.styleTween(n, V3(n, r)).on("end.style." + n, tS(n)) : typeof a == "function" ? this.styleTween(n, I3(n, r, qp(this, "style." + n, a))).each(X3(this._id, n)) : this.styleTween(n, Y3(n, r, a), s).on("end.style." + n, null);
}
function Z3(n, a, s) {
  return function(r) {
    this.style.setProperty(n, a.call(this, r), s);
  };
}
function Q3(n, a, s) {
  var r, o;
  function f() {
    var h = a.apply(this, arguments);
    return h !== o && (r = (o = h) && Z3(n, h, s)), r;
  }
  return f._value = a, f;
}
function K3(n, a, s) {
  var r = "style." + (n += "");
  if (arguments.length < 2) return (r = this.tween(r)) && r._value;
  if (a == null) return this.tween(r, null);
  if (typeof a != "function") throw new Error();
  return this.tween(r, Q3(n, a, s ?? ""));
}
function P3(n) {
  return function() {
    this.textContent = n;
  };
}
function J3(n) {
  return function() {
    var a = n(this);
    this.textContent = a ?? "";
  };
}
function F3(n) {
  return this.tween("text", typeof n == "function" ? J3(qp(this, "text", n)) : P3(n == null ? "" : n + ""));
}
function W3(n) {
  return function(a) {
    this.textContent = n.call(this, a);
  };
}
function eA(n) {
  var a, s;
  function r() {
    var o = n.apply(this, arguments);
    return o !== s && (a = (s = o) && W3(o)), a;
  }
  return r._value = n, r;
}
function tA(n) {
  var a = "text";
  if (arguments.length < 1) return (a = this.tween(a)) && a._value;
  if (n == null) return this.tween(a, null);
  if (typeof n != "function") throw new Error();
  return this.tween(a, eA(n));
}
function nA() {
  for (var n = this._name, a = this._id, s = nS(), r = this._groups, o = r.length, f = 0; f < o; ++f)
    for (var h = r[f], m = h.length, v, y = 0; y < m; ++y)
      if (v = h[y]) {
        var g = Ba(v, a);
        Pf(v, n, s, y, h, {
          time: g.time + g.delay + g.duration,
          delay: 0,
          duration: g.duration,
          ease: g.ease
        });
      }
  return new Rl(r, this._parents, n, s);
}
function iA() {
  var n, a, s = this, r = s._id, o = s.size();
  return new Promise(function(f, h) {
    var m = { value: h }, v = { value: function() {
      --o === 0 && f();
    } };
    s.each(function() {
      var y = ul(this, r), g = y.on;
      g !== n && (a = (n = g).copy(), a._.cancel.push(m), a._.interrupt.push(m), a._.end.push(v)), y.on = a;
    }), o === 0 && f();
  });
}
var aA = 0;
function Rl(n, a, s, r) {
  this._groups = n, this._parents = a, this._name = s, this._id = r;
}
function nS() {
  return ++aA;
}
var Cl = Lc.prototype;
Rl.prototype = {
  constructor: Rl,
  select: U3,
  selectAll: B3,
  selectChild: Cl.selectChild,
  selectChildren: Cl.selectChildren,
  filter: k3,
  merge: j3,
  selection: q3,
  transition: nA,
  call: Cl.call,
  nodes: Cl.nodes,
  node: Cl.node,
  size: Cl.size,
  empty: Cl.empty,
  each: Cl.each,
  on: D3,
  attr: p3,
  attrTween: b3,
  style: G3,
  styleTween: K3,
  text: F3,
  textTween: tA,
  remove: L3,
  tween: o3,
  delay: _3,
  duration: T3,
  ease: A3,
  easeVarying: z3,
  end: iA,
  [Symbol.iterator]: Cl[Symbol.iterator]
};
var lA = {
  time: null,
  // Set on use.
  delay: 0,
  duration: 250,
  ease: t3
};
function sA(n, a) {
  for (var s; !(s = n.__transition) || !(s = s[a]); )
    if (!(n = n.parentNode))
      throw new Error(`transition ${a} not found`);
  return s;
}
function rA(n) {
  var a, s;
  n instanceof Rl ? (a = n._id, n = n._name) : (a = nS(), (s = lA).time = Dp(), n = n == null ? null : n + "");
  for (var r = this._groups, o = r.length, f = 0; f < o; ++f)
    for (var h = r[f], m = h.length, v, y = 0; y < m; ++y)
      (v = h[y]) && Pf(v, n, a, y, h, s || sA(v, a));
  return new Rl(r, this._parents, n, a);
}
Lc.prototype.interrupt = l3;
Lc.prototype.transition = rA;
var uf = (n) => () => n;
function oA(n, {
  sourceEvent: a,
  target: s,
  transform: r,
  dispatch: o
}) {
  Object.defineProperties(this, {
    type: { value: n, enumerable: !0, configurable: !0 },
    sourceEvent: { value: a, enumerable: !0, configurable: !0 },
    target: { value: s, enumerable: !0, configurable: !0 },
    transform: { value: r, enumerable: !0, configurable: !0 },
    _: { value: o }
  });
}
function jl(n, a, s) {
  this.k = n, this.x = a, this.y = s;
}
jl.prototype = {
  constructor: jl,
  scale: function(n) {
    return n === 1 ? this : new jl(this.k * n, this.x, this.y);
  },
  translate: function(n, a) {
    return n === 0 & a === 0 ? this : new jl(this.k, this.x + this.k * n, this.y + this.k * a);
  },
  apply: function(n) {
    return [n[0] * this.k + this.x, n[1] * this.k + this.y];
  },
  applyX: function(n) {
    return n * this.k + this.x;
  },
  applyY: function(n) {
    return n * this.k + this.y;
  },
  invert: function(n) {
    return [(n[0] - this.x) / this.k, (n[1] - this.y) / this.k];
  },
  invertX: function(n) {
    return (n - this.x) / this.k;
  },
  invertY: function(n) {
    return (n - this.y) / this.k;
  },
  rescaleX: function(n) {
    return n.copy().domain(n.range().map(this.invertX, this).map(n.invert, n));
  },
  rescaleY: function(n) {
    return n.copy().domain(n.range().map(this.invertY, this).map(n.invert, n));
  },
  toString: function() {
    return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
  }
};
var Jf = new jl(1, 0, 0);
iS.prototype = jl.prototype;
function iS(n) {
  for (; !n.__zoom; ) if (!(n = n.parentNode)) return Jf;
  return n.__zoom;
}
function Om(n) {
  n.stopImmediatePropagation();
}
function cc(n) {
  n.preventDefault(), n.stopImmediatePropagation();
}
function cA(n) {
  return (!n.ctrlKey || n.type === "wheel") && !n.button;
}
function uA() {
  var n = this;
  return n instanceof SVGElement ? (n = n.ownerSVGElement || n, n.hasAttribute("viewBox") ? (n = n.viewBox.baseVal, [[n.x, n.y], [n.x + n.width, n.y + n.height]]) : [[0, 0], [n.width.baseVal.value, n.height.baseVal.value]]) : [[0, 0], [n.clientWidth, n.clientHeight]];
}
function $x() {
  return this.__zoom || Jf;
}
function fA(n) {
  return -n.deltaY * (n.deltaMode === 1 ? 0.05 : n.deltaMode ? 1 : 2e-3) * (n.ctrlKey ? 10 : 1);
}
function dA() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function hA(n, a, s) {
  var r = n.invertX(a[0][0]) - s[0][0], o = n.invertX(a[1][0]) - s[1][0], f = n.invertY(a[0][1]) - s[0][1], h = n.invertY(a[1][1]) - s[1][1];
  return n.translate(
    o > r ? (r + o) / 2 : Math.min(0, r) || Math.max(0, o),
    h > f ? (f + h) / 2 : Math.min(0, f) || Math.max(0, h)
  );
}
function aS() {
  var n = cA, a = uA, s = hA, r = fA, o = dA, f = [0, 1 / 0], h = [[-1 / 0, -1 / 0], [1 / 0, 1 / 0]], m = 250, v = Sf, y = Xf("start", "zoom", "end"), g, p, S, w = 500, E = 150, N = 0, _ = 10;
  function C(O) {
    O.property("__zoom", $x).on("wheel.zoom", H, { passive: !1 }).on("mousedown.zoom", q).on("dblclick.zoom", de).filter(o).on("touchstart.zoom", ee).on("touchmove.zoom", me).on("touchend.zoom touchcancel.zoom", te).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  C.transform = function(O, Y, j, B) {
    var X = O.selection ? O.selection() : O;
    X.property("__zoom", $x), O !== X ? Q(O, Y, j, B) : X.interrupt().each(function() {
      V(this, arguments).event(B).start().zoom(null, typeof Y == "function" ? Y.apply(this, arguments) : Y).end();
    });
  }, C.scaleBy = function(O, Y, j, B) {
    C.scaleTo(O, function() {
      var X = this.__zoom.k, J = typeof Y == "function" ? Y.apply(this, arguments) : Y;
      return X * J;
    }, j, B);
  }, C.scaleTo = function(O, Y, j, B) {
    C.transform(O, function() {
      var X = a.apply(this, arguments), J = this.__zoom, I = j == null ? R(X) : typeof j == "function" ? j.apply(this, arguments) : j, ae = J.invert(I), he = typeof Y == "function" ? Y.apply(this, arguments) : Y;
      return s(M(D(J, he), I, ae), X, h);
    }, j, B);
  }, C.translateBy = function(O, Y, j, B) {
    C.transform(O, function() {
      return s(this.__zoom.translate(
        typeof Y == "function" ? Y.apply(this, arguments) : Y,
        typeof j == "function" ? j.apply(this, arguments) : j
      ), a.apply(this, arguments), h);
    }, null, B);
  }, C.translateTo = function(O, Y, j, B, X) {
    C.transform(O, function() {
      var J = a.apply(this, arguments), I = this.__zoom, ae = B == null ? R(J) : typeof B == "function" ? B.apply(this, arguments) : B;
      return s(Jf.translate(ae[0], ae[1]).scale(I.k).translate(
        typeof Y == "function" ? -Y.apply(this, arguments) : -Y,
        typeof j == "function" ? -j.apply(this, arguments) : -j
      ), J, h);
    }, B, X);
  };
  function D(O, Y) {
    return Y = Math.max(f[0], Math.min(f[1], Y)), Y === O.k ? O : new jl(Y, O.x, O.y);
  }
  function M(O, Y, j) {
    var B = Y[0] - j[0] * O.k, X = Y[1] - j[1] * O.k;
    return B === O.x && X === O.y ? O : new jl(O.k, B, X);
  }
  function R(O) {
    return [(+O[0][0] + +O[1][0]) / 2, (+O[0][1] + +O[1][1]) / 2];
  }
  function Q(O, Y, j, B) {
    O.on("start.zoom", function() {
      V(this, arguments).event(B).start();
    }).on("interrupt.zoom end.zoom", function() {
      V(this, arguments).event(B).end();
    }).tween("zoom", function() {
      var X = this, J = arguments, I = V(X, J).event(B), ae = a.apply(X, J), he = j == null ? R(ae) : typeof j == "function" ? j.apply(X, J) : j, Ee = Math.max(ae[1][0] - ae[0][0], ae[1][1] - ae[0][1]), L = X.__zoom, ce = typeof Y == "function" ? Y.apply(X, J) : Y, pe = v(L.invert(he).concat(Ee / L.k), ce.invert(he).concat(Ee / ce.k));
      return function(Se) {
        if (Se === 1) Se = ce;
        else {
          var le = pe(Se), Te = Ee / le[2];
          Se = new jl(Te, he[0] - le[0] * Te, he[1] - le[1] * Te);
        }
        I.zoom(null, Se);
      };
    });
  }
  function V(O, Y, j) {
    return !j && O.__zooming || new k(O, Y);
  }
  function k(O, Y) {
    this.that = O, this.args = Y, this.active = 0, this.sourceEvent = null, this.extent = a.apply(O, Y), this.taps = 0;
  }
  k.prototype = {
    event: function(O) {
      return O && (this.sourceEvent = O), this;
    },
    start: function() {
      return ++this.active === 1 && (this.that.__zooming = this, this.emit("start")), this;
    },
    zoom: function(O, Y) {
      return this.mouse && O !== "mouse" && (this.mouse[1] = Y.invert(this.mouse[0])), this.touch0 && O !== "touch" && (this.touch0[1] = Y.invert(this.touch0[0])), this.touch1 && O !== "touch" && (this.touch1[1] = Y.invert(this.touch1[0])), this.that.__zoom = Y, this.emit("zoom"), this;
    },
    end: function() {
      return --this.active === 0 && (delete this.that.__zooming, this.emit("end")), this;
    },
    emit: function(O) {
      var Y = Fi(this.that).datum();
      y.call(
        O,
        this.that,
        new oA(O, {
          sourceEvent: this.sourceEvent,
          target: C,
          transform: this.that.__zoom,
          dispatch: y
        }),
        Y
      );
    }
  };
  function H(O, ...Y) {
    if (!n.apply(this, arguments)) return;
    var j = V(this, Y).event(O), B = this.__zoom, X = Math.max(f[0], Math.min(f[1], B.k * Math.pow(2, r.apply(this, arguments)))), J = ka(O);
    if (j.wheel)
      (j.mouse[0][0] !== J[0] || j.mouse[0][1] !== J[1]) && (j.mouse[1] = B.invert(j.mouse[0] = J)), clearTimeout(j.wheel);
    else {
      if (B.k === X) return;
      j.mouse = [J, B.invert(J)], Ef(this), j.start();
    }
    cc(O), j.wheel = setTimeout(I, E), j.zoom("mouse", s(M(D(B, X), j.mouse[0], j.mouse[1]), j.extent, h));
    function I() {
      j.wheel = null, j.end();
    }
  }
  function q(O, ...Y) {
    if (S || !n.apply(this, arguments)) return;
    var j = O.currentTarget, B = V(this, Y, !0).event(O), X = Fi(O.view).on("mousemove.zoom", he, !0).on("mouseup.zoom", Ee, !0), J = ka(O, j), I = O.clientX, ae = O.clientY;
    kb(O.view), Om(O), B.mouse = [J, this.__zoom.invert(J)], Ef(this), B.start();
    function he(L) {
      if (cc(L), !B.moved) {
        var ce = L.clientX - I, pe = L.clientY - ae;
        B.moved = ce * ce + pe * pe > N;
      }
      B.event(L).zoom("mouse", s(M(B.that.__zoom, B.mouse[0] = ka(L, j), B.mouse[1]), B.extent, h));
    }
    function Ee(L) {
      X.on("mousemove.zoom mouseup.zoom", null), jb(L.view, B.moved), cc(L), B.event(L).end();
    }
  }
  function de(O, ...Y) {
    if (n.apply(this, arguments)) {
      var j = this.__zoom, B = ka(O.changedTouches ? O.changedTouches[0] : O, this), X = j.invert(B), J = j.k * (O.shiftKey ? 0.5 : 2), I = s(M(D(j, J), B, X), a.apply(this, Y), h);
      cc(O), m > 0 ? Fi(this).transition().duration(m).call(Q, I, B, O) : Fi(this).call(C.transform, I, B, O);
    }
  }
  function ee(O, ...Y) {
    if (n.apply(this, arguments)) {
      var j = O.touches, B = j.length, X = V(this, Y, O.changedTouches.length === B).event(O), J, I, ae, he;
      for (Om(O), I = 0; I < B; ++I)
        ae = j[I], he = ka(ae, this), he = [he, this.__zoom.invert(he), ae.identifier], X.touch0 ? !X.touch1 && X.touch0[2] !== he[2] && (X.touch1 = he, X.taps = 0) : (X.touch0 = he, J = !0, X.taps = 1 + !!g);
      g && (g = clearTimeout(g)), J && (X.taps < 2 && (p = he[0], g = setTimeout(function() {
        g = null;
      }, w)), Ef(this), X.start());
    }
  }
  function me(O, ...Y) {
    if (this.__zooming) {
      var j = V(this, Y).event(O), B = O.changedTouches, X = B.length, J, I, ae, he;
      for (cc(O), J = 0; J < X; ++J)
        I = B[J], ae = ka(I, this), j.touch0 && j.touch0[2] === I.identifier ? j.touch0[0] = ae : j.touch1 && j.touch1[2] === I.identifier && (j.touch1[0] = ae);
      if (I = j.that.__zoom, j.touch1) {
        var Ee = j.touch0[0], L = j.touch0[1], ce = j.touch1[0], pe = j.touch1[1], Se = (Se = ce[0] - Ee[0]) * Se + (Se = ce[1] - Ee[1]) * Se, le = (le = pe[0] - L[0]) * le + (le = pe[1] - L[1]) * le;
        I = D(I, Math.sqrt(Se / le)), ae = [(Ee[0] + ce[0]) / 2, (Ee[1] + ce[1]) / 2], he = [(L[0] + pe[0]) / 2, (L[1] + pe[1]) / 2];
      } else if (j.touch0) ae = j.touch0[0], he = j.touch0[1];
      else return;
      j.zoom("touch", s(M(I, ae, he), j.extent, h));
    }
  }
  function te(O, ...Y) {
    if (this.__zooming) {
      var j = V(this, Y).event(O), B = O.changedTouches, X = B.length, J, I;
      for (Om(O), S && clearTimeout(S), S = setTimeout(function() {
        S = null;
      }, w), J = 0; J < X; ++J)
        I = B[J], j.touch0 && j.touch0[2] === I.identifier ? delete j.touch0 : j.touch1 && j.touch1[2] === I.identifier && delete j.touch1;
      if (j.touch1 && !j.touch0 && (j.touch0 = j.touch1, delete j.touch1), j.touch0) j.touch0[1] = this.__zoom.invert(j.touch0[0]);
      else if (j.end(), j.taps === 2 && (I = ka(I, this), Math.hypot(p[0] - I[0], p[1] - I[1]) < _)) {
        var ae = Fi(this).on("dblclick.zoom");
        ae && ae.apply(this, arguments);
      }
    }
  }
  return C.wheelDelta = function(O) {
    return arguments.length ? (r = typeof O == "function" ? O : uf(+O), C) : r;
  }, C.filter = function(O) {
    return arguments.length ? (n = typeof O == "function" ? O : uf(!!O), C) : n;
  }, C.touchable = function(O) {
    return arguments.length ? (o = typeof O == "function" ? O : uf(!!O), C) : o;
  }, C.extent = function(O) {
    return arguments.length ? (a = typeof O == "function" ? O : uf([[+O[0][0], +O[0][1]], [+O[1][0], +O[1][1]]]), C) : a;
  }, C.scaleExtent = function(O) {
    return arguments.length ? (f[0] = +O[0], f[1] = +O[1], C) : [f[0], f[1]];
  }, C.translateExtent = function(O) {
    return arguments.length ? (h[0][0] = +O[0][0], h[1][0] = +O[1][0], h[0][1] = +O[0][1], h[1][1] = +O[1][1], C) : [[h[0][0], h[0][1]], [h[1][0], h[1][1]]];
  }, C.constrain = function(O) {
    return arguments.length ? (s = O, C) : s;
  }, C.duration = function(O) {
    return arguments.length ? (m = +O, C) : m;
  }, C.interpolate = function(O) {
    return arguments.length ? (v = O, C) : v;
  }, C.on = function() {
    var O = y.on.apply(y, arguments);
    return O === y ? C : O;
  }, C.clickDistance = function(O) {
    return arguments.length ? (N = (O = +O) * O, C) : Math.sqrt(N);
  }, C.tapDistance = function(O) {
    return arguments.length ? (_ = +O, C) : _;
  }, C;
}
const Ua = {
  error001: (n = "react") => `Seems like you have not used ${n === "svelte" ? "SvelteFlowProvider" : "ReactFlowProvider"} as an ancestor. Help: https://${n}flow.dev/error#001`,
  error002: () => "It looks like you've created a new nodeTypes or edgeTypes object. If this wasn't on purpose please define the nodeTypes/edgeTypes outside of the component or memoize them.",
  error003: (n) => `Node type "${n}" not found. Using fallback type "default".`,
  error004: () => "The parent container needs a width and a height to render the graph.",
  error005: () => "Only child nodes can use a parent extent.",
  error006: () => "Can't create edge. An edge needs a source and a target.",
  error007: (n) => `The old edge with id=${n} does not exist.`,
  error009: (n) => `Marker type "${n}" doesn't exist.`,
  error008: (n, { id: a, sourceHandle: s, targetHandle: r }) => `Couldn't create edge for ${n} handle id: "${n === "source" ? s : r}", edge id: ${a}.`,
  error010: () => "Handle: No node id found. Make sure to only use a Handle inside a custom Node.",
  error011: (n) => `Edge type "${n}" not found. Using fallback type "default".`,
  error012: (n) => `Node with id "${n}" does not exist, it may have been removed. This can happen when a node is deleted before the "onNodeClick" handler is called.`,
  error013: (n = "react") => `It seems that you haven't loaded the styles. Please import '@xyflow/${n}/dist/style.css' or base.css to make sure everything is working properly.`,
  error014: () => "useNodeConnections: No node ID found. Call useNodeConnections inside a custom Node or provide a node ID.",
  error015: () => "It seems that you are trying to drag a node that is not initialized. Please use onNodesChange as explained in the docs.",
  error016: (n) => `Edge with id "${n}" does not exist, it may have been removed. This can happen when an edge is deleted before the "onEdgeClick" handler is called.`
}, jc = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
], lS = ["Enter", " ", "Escape"], sS = {
  "node.a11yDescription.default": "Press enter or space to select a node. Press delete to remove it and escape to cancel.",
  "node.a11yDescription.keyboardDisabled": "Press enter or space to select a node. You can then use the arrow keys to move the node around. Press delete to remove it and escape to cancel.",
  "node.a11yDescription.ariaLiveMessage": ({ direction: n, x: a, y: s }) => `Moved selected node ${n}. New position, x: ${a}, y: ${s}`,
  "edge.a11yDescription.default": "Press enter or space to select an edge. You can then press delete to remove it or escape to cancel.",
  // Control elements
  "controls.ariaLabel": "Control Panel",
  "controls.zoomIn.ariaLabel": "Zoom In",
  "controls.zoomOut.ariaLabel": "Zoom Out",
  "controls.fitView.ariaLabel": "Fit View",
  "controls.interactive.ariaLabel": "Toggle Interactivity",
  // Mini map
  "minimap.ariaLabel": "Mini Map",
  // Handle
  "handle.ariaLabel": "Handle"
};
var uo;
(function(n) {
  n.Strict = "strict", n.Loose = "loose";
})(uo || (uo = {}));
var Js;
(function(n) {
  n.Free = "free", n.Vertical = "vertical", n.Horizontal = "horizontal";
})(Js || (Js = {}));
var fo;
(function(n) {
  n.Partial = "partial", n.Full = "full";
})(fo || (fo = {}));
const rS = {
  inProgress: !1,
  isValid: null,
  from: null,
  fromHandle: null,
  fromPosition: null,
  fromNode: null,
  to: null,
  toHandle: null,
  toPosition: null,
  toNode: null,
  pointer: null
};
var ps;
(function(n) {
  n.Bezier = "default", n.Straight = "straight", n.Step = "step", n.SmoothStep = "smoothstep", n.SimpleBezier = "simplebezier";
})(ps || (ps = {}));
var Lf;
(function(n) {
  n.Arrow = "arrow", n.ArrowClosed = "arrowclosed";
})(Lf || (Lf = {}));
var Ue;
(function(n) {
  n.Left = "left", n.Top = "top", n.Right = "right", n.Bottom = "bottom";
})(Ue || (Ue = {}));
const qx = {
  [Ue.Left]: Ue.Right,
  [Ue.Right]: Ue.Left,
  [Ue.Top]: Ue.Bottom,
  [Ue.Bottom]: Ue.Top
}, oS = (n) => !!n && typeof n == "object" && "id" in n && "source" in n && "target" in n, mA = (n) => !!n && typeof n == "object" && "id" in n && "position" in n && !("source" in n) && !("target" in n), Vp = (n) => !!n && typeof n == "object" && "id" in n && "internals" in n && !("source" in n) && !("target" in n), Bc = (n, a = [0, 0]) => {
  const { width: s, height: r } = $a(n), o = n.origin ?? a, f = s * o[0], h = r * o[1];
  return {
    x: n.position.x - f,
    y: n.position.y - h
  };
}, pA = (n, a = { nodeOrigin: [0, 0] }) => {
  if (n.length === 0)
    return { x: 0, y: 0, width: 0, height: 0 };
  let s = !1;
  const r = n.reduce((o, f) => {
    const h = typeof f == "string";
    let m = !a.nodeLookup && !h ? f : void 0;
    return a.nodeLookup && (m = h ? a.nodeLookup.get(f) : Vp(f) ? f : a.nodeLookup.get(f.id)), m ? (s = !0, Ff(o, Uf(m, a.nodeOrigin))) : o;
  }, { x: 1 / 0, y: 1 / 0, x2: -1 / 0, y2: -1 / 0 });
  return s ? Wf(r) : { x: 0, y: 0, width: 0, height: 0 };
}, $c = (n, a = {}) => {
  let s = { x: 1 / 0, y: 1 / 0, x2: -1 / 0, y2: -1 / 0 }, r = !1;
  return n.forEach((o) => {
    (a.filter === void 0 || a.filter(o)) && (s = Ff(s, Uf(o)), r = !0);
  }), r ? Wf(s) : { x: 0, y: 0, width: 0, height: 0 };
}, Yp = (n, a, [s, r, o] = [0, 0, 1], f = !1, h = !1) => {
  const m = (a.x - s) / o, v = (a.y - r) / o, y = a.width / o, g = a.height / o, p = [];
  for (const S of n.values()) {
    const { measured: w, selectable: E = !0, hidden: N = !1 } = S;
    if (h && !E || N)
      continue;
    const _ = w.width ?? S.width ?? S.initialWidth ?? 0, C = w.height ?? S.height ?? S.initialHeight ?? 0, { x: D, y: M } = S.internals.positionAbsolute, R = dS(m, v, y, g, D, M, _, C), Q = _ * C, V = f && R > 0;
    (!S.internals.handleBounds || V || R >= Q || S.dragging) && p.push(S);
  }
  return p;
}, gA = (n, a) => {
  const s = /* @__PURE__ */ new Set();
  return n.forEach((r) => {
    s.add(r.id);
  }), a.filter((r) => s.has(r.source) || s.has(r.target));
};
function yA(n, a) {
  const s = /* @__PURE__ */ new Map(), r = a?.nodes ? new Set(a.nodes.map((o) => o.id)) : null;
  return n.forEach((o) => {
    let f;
    if (a?.includeHiddenNodes) {
      const { width: h, height: m } = $a(o);
      f = h > 0 && m > 0;
    } else
      f = !!(o.measured.width && o.measured.height && !o.hidden);
    f && (!r || r.has(o.id)) && s.set(o.id, o);
  }), s;
}
async function vA({ nodes: n, width: a, height: s, panZoom: r, minZoom: o, maxZoom: f }, h) {
  if (n.size === 0)
    return !0;
  const m = yA(n, h), v = $c(m), y = Xp(v, a, s, h?.minZoom ?? o, h?.maxZoom ?? f, h?.padding ?? 0.1);
  return await r.setViewport(y, {
    duration: h?.duration,
    ease: h?.ease,
    interpolate: h?.interpolate
  }), !0;
}
function cS({ nodeId: n, nextPosition: a, nodeLookup: s, nodeOrigin: r = [0, 0], nodeExtent: o, onError: f }) {
  const h = s.get(n), m = h.parentId ? s.get(h.parentId) : void 0, { x: v, y } = m ? m.internals.positionAbsolute : { x: 0, y: 0 }, g = h.origin ?? r;
  let p = h.extent || o;
  if (h.extent === "parent" && !h.expandParent)
    if (!m)
      f?.("005", Ua.error005());
    else {
      const { width: w, height: E } = $a(m);
      w && E && (p = [
        [v, y],
        [v + w, y + E]
      ]);
    }
  else m && nr(h.extent) && (p = [
    [h.extent[0][0] + v, h.extent[0][1] + y],
    [h.extent[1][0] + v, h.extent[1][1] + y]
  ]);
  const S = nr(p) ? tr(a, p, h.measured) : a;
  return (h.measured.width === void 0 || h.measured.height === void 0) && f?.("015", Ua.error015()), {
    position: {
      x: S.x - v + (h.measured.width ?? 0) * g[0],
      y: S.y - y + (h.measured.height ?? 0) * g[1]
    },
    positionAbsolute: S
  };
}
async function xA({ nodesToRemove: n = [], edgesToRemove: a = [], nodes: s, edges: r, onBeforeDelete: o }) {
  const f = new Set(n.map((S) => S.id)), h = [];
  for (const S of s) {
    if (S.deletable === !1)
      continue;
    const w = f.has(S.id), E = !w && S.parentId && h.find((N) => N.id === S.parentId);
    (w || E) && h.push(S);
  }
  const m = new Set(a.map((S) => S.id)), v = r.filter((S) => S.deletable !== !1), g = gA(h, v);
  for (const S of v)
    m.has(S.id) && !g.find((E) => E.id === S.id) && g.push(S);
  if (!o)
    return {
      edges: g,
      nodes: h
    };
  const p = await o({
    nodes: h,
    edges: g
  });
  return typeof p == "boolean" ? p ? { edges: g, nodes: h } : { edges: [], nodes: [] } : p;
}
const ho = (n, a = 0, s = 1) => Math.min(Math.max(n, a), s), tr = (n = { x: 0, y: 0 }, a, s) => ({
  x: ho(n.x, a[0][0], a[1][0] - (s?.width ?? 0)),
  y: ho(n.y, a[0][1], a[1][1] - (s?.height ?? 0))
});
function uS(n, a, s) {
  const { width: r, height: o } = $a(s), { x: f, y: h } = s.internals.positionAbsolute;
  return tr(n, [
    [f, h],
    [f + r, h + o]
  ], a);
}
const Vx = (n, a, s) => n < a ? ho(Math.abs(n - a), 1, a) / a : n > s ? -ho(Math.abs(n - s), 1, a) / a : 0, Ip = (n, a, s = 15, r = 40) => {
  const o = Vx(n.x, r, a.width - r) * s, f = Vx(n.y, r, a.height - r) * s;
  return [o, f];
}, Ff = (n, a) => ({
  x: Math.min(n.x, a.x),
  y: Math.min(n.y, a.y),
  x2: Math.max(n.x2, a.x2),
  y2: Math.max(n.y2, a.y2)
}), gp = ({ x: n, y: a, width: s, height: r }) => ({
  x: n,
  y: a,
  x2: n + s,
  y2: a + r
}), Wf = ({ x: n, y: a, x2: s, y2: r }) => ({
  x: n,
  y: a,
  width: s - n,
  height: r - a
}), Rc = (n, a = [0, 0]) => {
  const { x: s, y: r } = Vp(n) ? n.internals.positionAbsolute : Bc(n, a);
  return {
    x: s,
    y: r,
    width: n.measured?.width ?? n.width ?? n.initialWidth ?? 0,
    height: n.measured?.height ?? n.height ?? n.initialHeight ?? 0
  };
}, Uf = (n, a = [0, 0]) => {
  const { x: s, y: r } = Vp(n) ? n.internals.positionAbsolute : Bc(n, a);
  return {
    x: s,
    y: r,
    x2: s + (n.measured?.width ?? n.width ?? n.initialWidth ?? 0),
    y2: r + (n.measured?.height ?? n.height ?? n.initialHeight ?? 0)
  };
}, fS = (n, a) => Wf(Ff(gp(n), gp(a))), dS = (n, a, s, r, o, f, h, m) => {
  const v = Math.max(0, Math.min(n + s, o + h) - Math.max(n, o)), y = Math.max(0, Math.min(a + r, f + m) - Math.max(a, f));
  return Math.ceil(v * y);
}, Bf = (n, a) => dS(n.x, n.y, n.width, n.height, a.x, a.y, a.width, a.height), Yx = (n) => Da(n.width) && Da(n.height) && Da(n.x) && Da(n.y), Da = (n) => !isNaN(n) && isFinite(n), hS = (n, a) => (s, r) => {
}, qc = (n, a = [1, 1]) => ({
  x: a[0] * Math.round(n.x / a[0]),
  y: a[1] * Math.round(n.y / a[1])
}), Vc = ({ x: n, y: a }, [s, r, o], f = !1, h = [1, 1]) => {
  const m = {
    x: (n - s) / o,
    y: (a - r) / o
  };
  return f ? qc(m, h) : m;
}, mo = ({ x: n, y: a }, [s, r, o]) => ({
  x: n * o + s,
  y: a * o + r
});
function Qr(n, a) {
  if (typeof n == "number")
    return Math.floor((a - a / (1 + n)) * 0.5);
  if (typeof n == "string" && n.endsWith("px")) {
    const s = parseFloat(n);
    if (!Number.isNaN(s))
      return Math.floor(s);
  }
  if (typeof n == "string" && n.endsWith("%")) {
    const s = parseFloat(n);
    if (!Number.isNaN(s))
      return Math.floor(a * s * 0.01);
  }
  return console.error(`The padding value "${n}" is invalid. Please provide a number or a string with a valid unit (px or %).`), 0;
}
function bA(n, a, s) {
  if (typeof n == "string" || typeof n == "number") {
    const r = Qr(n, s), o = Qr(n, a);
    return {
      top: r,
      right: o,
      bottom: r,
      left: o,
      x: o * 2,
      y: r * 2
    };
  }
  if (typeof n == "object") {
    const r = Qr(n.top ?? n.y ?? 0, s), o = Qr(n.bottom ?? n.y ?? 0, s), f = Qr(n.left ?? n.x ?? 0, a), h = Qr(n.right ?? n.x ?? 0, a);
    return { top: r, right: h, bottom: o, left: f, x: f + h, y: r + o };
  }
  return { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0 };
}
function SA(n, a, s, r, o, f) {
  const { x: h, y: m } = mo(n, [a, s, r]), { x: v, y } = mo({ x: n.x + n.width, y: n.y + n.height }, [a, s, r]), g = o - v, p = f - y;
  return {
    left: Math.floor(h),
    top: Math.floor(m),
    right: Math.floor(g),
    bottom: Math.floor(p)
  };
}
const Xp = (n, a, s, r, o, f) => {
  const h = bA(f, a, s), m = (a - h.x) / n.width, v = (s - h.y) / n.height, y = Math.min(m, v), g = ho(y, r, o), p = n.x + n.width / 2, S = n.y + n.height / 2, w = a / 2 - p * g, E = s / 2 - S * g, N = SA(n, w, E, g, a, s), _ = {
    left: Math.min(N.left - h.left, 0),
    top: Math.min(N.top - h.top, 0),
    right: Math.min(N.right - h.right, 0),
    bottom: Math.min(N.bottom - h.bottom, 0)
  };
  return {
    x: w - _.left + _.right,
    y: E - _.top + _.bottom,
    zoom: g
  };
}, Oc = () => typeof navigator < "u" && navigator?.userAgent?.indexOf("Mac") >= 0;
function nr(n) {
  return n != null && n !== "parent";
}
function $a(n) {
  return {
    width: n.measured?.width ?? n.width ?? n.initialWidth ?? 0,
    height: n.measured?.height ?? n.height ?? n.initialHeight ?? 0
  };
}
function mS(n) {
  return (n.measured?.width ?? n.width ?? n.initialWidth) !== void 0 && (n.measured?.height ?? n.height ?? n.initialHeight) !== void 0;
}
function pS(n, a = { width: 0, height: 0 }, s, r, o) {
  const f = { ...n }, h = r.get(s);
  if (h) {
    const m = h.origin || o;
    f.x += h.internals.positionAbsolute.x - (a.width ?? 0) * m[0], f.y += h.internals.positionAbsolute.y - (a.height ?? 0) * m[1];
  }
  return f;
}
function Ix(n, a) {
  if (n.size !== a.size)
    return !1;
  for (const s of n)
    if (!a.has(s))
      return !1;
  return !0;
}
function wA() {
  let n, a;
  return { promise: new Promise((r, o) => {
    n = r, a = o;
  }), resolve: n, reject: a };
}
function _A(n) {
  return { ...sS, ...n || {} };
}
function gS(n) {
  return n === null ? null : n ? "valid" : "invalid";
}
function Tc(n, { snapGrid: a = [0, 0], snapToGrid: s = !1, transform: r, containerBounds: o }) {
  const { x: f, y: h } = Ha(n), m = Vc({ x: f - (o?.left ?? 0), y: h - (o?.top ?? 0) }, r), { x: v, y } = s ? qc(m, a) : m;
  return {
    xSnapped: v,
    ySnapped: y,
    ...m
  };
}
const Gp = (n) => ({
  width: n.offsetWidth,
  height: n.offsetHeight
}), yS = (n) => n?.getRootNode?.() || window?.document, EA = ["INPUT", "SELECT", "TEXTAREA"];
function vS(n) {
  const a = n.composedPath?.()?.[0] || n.target;
  return a?.nodeType !== 1 ? !1 : EA.includes(a.nodeName) || a.hasAttribute("contenteditable") || !!a.closest(".nokey");
}
const xS = (n) => "clientX" in n, Ha = (n, a) => {
  const s = xS(n), r = s ? n.clientX : n.touches?.[0].clientX, o = s ? n.clientY : n.touches?.[0].clientY;
  return {
    x: r - (a?.left ?? 0),
    y: o - (a?.top ?? 0)
  };
}, Xx = (n, a, s, r, o) => {
  const f = a.querySelectorAll(`.${n}`);
  return !f || !f.length ? null : Array.from(f).map((h) => {
    const m = h.getBoundingClientRect();
    return {
      id: h.getAttribute("data-handleid"),
      type: n,
      nodeId: o,
      position: h.getAttribute("data-handlepos"),
      x: (m.left - s.left) / r,
      y: (m.top - s.top) / r,
      ...Gp(h)
    };
  });
};
function bS({ sourceX: n, sourceY: a, targetX: s, targetY: r, sourceControlX: o, sourceControlY: f, targetControlX: h, targetControlY: m }) {
  const v = n * 0.125 + o * 0.375 + h * 0.375 + s * 0.125, y = a * 0.125 + f * 0.375 + m * 0.375 + r * 0.125, g = Math.abs(v - n), p = Math.abs(y - a);
  return [v, y, g, p];
}
function ff(n, a) {
  return n >= 0 ? 0.5 * n : a * 25 * Math.sqrt(-n);
}
function Gx({ pos: n, x1: a, y1: s, x2: r, y2: o, c: f }) {
  switch (n) {
    case Ue.Left:
      return [a - ff(a - r, f), s];
    case Ue.Right:
      return [a + ff(r - a, f), s];
    case Ue.Top:
      return [a, s - ff(s - o, f)];
    case Ue.Bottom:
      return [a, s + ff(o - s, f)];
  }
}
function SS({ sourceX: n, sourceY: a, sourcePosition: s = Ue.Bottom, targetX: r, targetY: o, targetPosition: f = Ue.Top, curvature: h = 0.25 }) {
  const [m, v] = Gx({
    pos: s,
    x1: n,
    y1: a,
    x2: r,
    y2: o,
    c: h
  }), [y, g] = Gx({
    pos: f,
    x1: r,
    y1: o,
    x2: n,
    y2: a,
    c: h
  }), [p, S, w, E] = bS({
    sourceX: n,
    sourceY: a,
    targetX: r,
    targetY: o,
    sourceControlX: m,
    sourceControlY: v,
    targetControlX: y,
    targetControlY: g
  });
  return [
    `M${n},${a} C${m},${v} ${y},${g} ${r},${o}`,
    p,
    S,
    w,
    E
  ];
}
function wS({ sourceX: n, sourceY: a, targetX: s, targetY: r }) {
  const o = Math.abs(s - n) / 2, f = s < n ? s + o : s - o, h = Math.abs(r - a) / 2, m = r < a ? r + h : r - h;
  return [f, m, o, h];
}
function NA({ sourceNode: n, targetNode: a, selected: s = !1, zIndex: r = 0, elevateOnSelect: o = !1, zIndexMode: f = "basic" }) {
  if (f === "manual")
    return r;
  const h = o && s ? r + 1e3 : r, m = Math.max(n.parentId || o && n.selected ? n.internals.z : 0, a.parentId || o && a.selected ? a.internals.z : 0);
  return h + m;
}
function TA({ sourceNode: n, targetNode: a, width: s, height: r, transform: o }) {
  const f = Ff(Uf(n), Uf(a));
  f.x === f.x2 && (f.x2 += 1), f.y === f.y2 && (f.y2 += 1);
  const h = {
    x: -o[0] / o[2],
    y: -o[1] / o[2],
    width: s / o[2],
    height: r / o[2]
  };
  return Bf(h, Wf(f)) > 0;
}
const CA = ({ source: n, sourceHandle: a, target: s, targetHandle: r }) => `xy-edge__${n}${a || ""}-${s}${r || ""}`, AA = (n, a) => a.some((s) => s.source === n.source && s.target === n.target && (s.sourceHandle === n.sourceHandle || !s.sourceHandle && !n.sourceHandle) && (s.targetHandle === n.targetHandle || !s.targetHandle && !n.targetHandle)), MA = (n, a, s = {}) => {
  if (!n.source || !n.target)
    return s.onError?.("006", Ua.error006()), a;
  const r = s.getEdgeId || CA;
  let o;
  return oS(n) ? o = { ...n } : o = {
    ...n,
    id: r(n)
  }, AA(o, a) ? a : (o.sourceHandle === null && delete o.sourceHandle, o.targetHandle === null && delete o.targetHandle, a.concat(o));
};
function _S({ sourceX: n, sourceY: a, targetX: s, targetY: r }) {
  const [o, f, h, m] = wS({
    sourceX: n,
    sourceY: a,
    targetX: s,
    targetY: r
  });
  return [`M ${n},${a}L ${s},${r}`, o, f, h, m];
}
const Zx = {
  [Ue.Left]: { x: -1, y: 0 },
  [Ue.Right]: { x: 1, y: 0 },
  [Ue.Top]: { x: 0, y: -1 },
  [Ue.Bottom]: { x: 0, y: 1 }
}, zA = ({ source: n, sourcePosition: a = Ue.Bottom, target: s }) => a === Ue.Left || a === Ue.Right ? n.x < s.x ? { x: 1, y: 0 } : { x: -1, y: 0 } : n.y < s.y ? { x: 0, y: 1 } : { x: 0, y: -1 }, Qx = (n, a) => Math.sqrt(Math.pow(a.x - n.x, 2) + Math.pow(a.y - n.y, 2)), kA = (n, a, s) => n.x === a.x && a.x === s.x && (a.y - n.y) * (s.y - a.y) >= 0 || n.y === a.y && a.y === s.y && (a.x - n.x) * (s.x - a.x) >= 0;
function jA({ source: n, sourcePosition: a = Ue.Bottom, target: s, targetPosition: r = Ue.Top, center: o, offset: f, stepPosition: h }) {
  const m = Zx[a], v = Zx[r], y = { x: n.x + m.x * f, y: n.y + m.y * f }, g = { x: s.x + v.x * f, y: s.y + v.y * f }, p = zA({
    source: y,
    sourcePosition: a,
    target: g
  }), S = p.x !== 0 ? "x" : "y", w = p[S];
  let E = [], N, _;
  const C = { x: 0, y: 0 }, D = { x: 0, y: 0 }, [, , M, R] = wS({
    sourceX: n.x,
    sourceY: n.y,
    targetX: s.x,
    targetY: s.y
  });
  if (m[S] * v[S] === -1) {
    S === "x" ? (N = o.x ?? y.x + (g.x - y.x) * h, _ = o.y ?? (y.y + g.y) / 2) : (N = o.x ?? (y.x + g.x) / 2, _ = o.y ?? y.y + (g.y - y.y) * h);
    const H = [
      { x: N, y: y.y },
      { x: N, y: g.y }
    ], q = [
      { x: y.x, y: _ },
      { x: g.x, y: _ }
    ];
    m[S] === w ? E = S === "x" ? H : q : E = S === "x" ? q : H;
  } else {
    const H = [{ x: y.x, y: g.y }], q = [{ x: g.x, y: y.y }];
    if (S === "x" ? E = m.x === w ? q : H : E = m.y === w ? H : q, a === r) {
      const O = Math.abs(n[S] - s[S]);
      if (O <= f) {
        const Y = Math.min(f - 1, f - O);
        m[S] === w ? C[S] = (y[S] > n[S] ? -1 : 1) * Y : D[S] = (g[S] > s[S] ? -1 : 1) * Y;
      }
    }
    if (a !== r) {
      const O = S === "x" ? "y" : "x", Y = m[S] === v[O], j = y[O] > g[O], B = y[O] < g[O];
      (m[S] === 1 && (!Y && j || Y && B) || m[S] !== 1 && (!Y && B || Y && j)) && (E = S === "x" ? H : q);
    }
    const de = { x: y.x + C.x, y: y.y + C.y }, ee = { x: g.x + D.x, y: g.y + D.y }, me = Math.max(Math.abs(de.x - E[0].x), Math.abs(ee.x - E[0].x)), te = Math.max(Math.abs(de.y - E[0].y), Math.abs(ee.y - E[0].y));
    me >= te ? (N = (de.x + ee.x) / 2, _ = E[0].y) : (N = E[0].x, _ = (de.y + ee.y) / 2);
  }
  const Q = { x: y.x + C.x, y: y.y + C.y }, V = { x: g.x + D.x, y: g.y + D.y }, k = [];
  for (const H of [n, Q, ...E, V, s]) {
    const [q, de] = k.slice(-2);
    de && kA(q, de, H) && k.pop(), k.push(H);
  }
  return [k, N, _, M, R];
}
function RA(n, a, s, r) {
  const o = Math.min(Qx(n, a) / 2, Qx(a, s) / 2, r), { x: f, y: h } = a;
  if (n.x === f && f === s.x || n.y === h && h === s.y)
    return `L${f} ${h}`;
  if (n.y === h) {
    const y = n.x < s.x ? -1 : 1, g = n.y < s.y ? 1 : -1;
    return `L ${f + o * y},${h}Q ${f},${h} ${f},${h + o * g}`;
  }
  const m = n.x < s.x ? 1 : -1, v = n.y < s.y ? -1 : 1;
  return `L ${f},${h + o * v}Q ${f},${h} ${f + o * m},${h}`;
}
function yp({ sourceX: n, sourceY: a, sourcePosition: s = Ue.Bottom, targetX: r, targetY: o, targetPosition: f = Ue.Top, borderRadius: h = 5, centerX: m, centerY: v, offset: y = 20, stepPosition: g = 0.5 }) {
  const [p, S, w, E, N] = jA({
    source: { x: n, y: a },
    sourcePosition: s,
    target: { x: r, y: o },
    targetPosition: f,
    center: { x: m, y: v },
    offset: y,
    stepPosition: g
  });
  let _ = `M${p[0].x} ${p[0].y}`;
  for (let C = 1; C < p.length - 1; C++)
    _ += RA(p[C - 1], p[C], p[C + 1], h);
  return _ += `L${p[p.length - 1].x} ${p[p.length - 1].y}`, [_, S, w, E, N];
}
function Kx(n) {
  return n && !!(n.internals.handleBounds || n.handles?.length) && !!(n.measured.width || n.width || n.initialWidth);
}
function OA(n) {
  const { sourceNode: a, targetNode: s } = n;
  if (!Kx(a) || !Kx(s))
    return null;
  const r = a.internals.handleBounds || Px(a.handles), o = s.internals.handleBounds || Px(s.handles), f = Jx(r?.source ?? [], n.sourceHandle), h = Jx(
    // when connection type is loose we can define all handles as sources and connect source -> source
    n.connectionMode === uo.Strict ? o?.target ?? [] : (o?.target ?? []).concat(o?.source ?? []),
    n.targetHandle
  );
  if (!f || !h)
    return n.onError?.("008", Ua.error008(f ? "target" : "source", {
      id: n.id,
      sourceHandle: n.sourceHandle,
      targetHandle: n.targetHandle
    })), null;
  const m = f?.position || Ue.Bottom, v = h?.position || Ue.Top, y = ir(a, f, m), g = ir(s, h, v);
  return {
    sourceX: y.x,
    sourceY: y.y,
    targetX: g.x,
    targetY: g.y,
    sourcePosition: m,
    targetPosition: v
  };
}
function Px(n) {
  if (!n)
    return null;
  const a = [], s = [];
  for (const r of n)
    r.width = r.width ?? 1, r.height = r.height ?? 1, r.type === "source" ? a.push(r) : r.type === "target" && s.push(r);
  return {
    source: a,
    target: s
  };
}
function ir(n, a, s = Ue.Left, r = !1) {
  const o = (a?.x ?? 0) + n.internals.positionAbsolute.x, f = (a?.y ?? 0) + n.internals.positionAbsolute.y, { width: h, height: m } = a ?? $a(n);
  if (r)
    return { x: o + h / 2, y: f + m / 2 };
  switch (a?.position ?? s) {
    case Ue.Top:
      return { x: o + h / 2, y: f };
    case Ue.Right:
      return { x: o + h, y: f + m / 2 };
    case Ue.Bottom:
      return { x: o + h / 2, y: f + m };
    case Ue.Left:
      return { x: o, y: f + m / 2 };
  }
}
function Jx(n, a) {
  return n && (a ? n.find((s) => s.id === a) : n[0]) || null;
}
function vp(n, a) {
  return n ? typeof n == "string" ? n : `${a ? `${a}__` : ""}${Object.keys(n).sort().map((r) => `${r}=${n[r]}`).join("&")}` : "";
}
function DA(n, { id: a, defaultColor: s, defaultMarkerStart: r, defaultMarkerEnd: o }) {
  const f = /* @__PURE__ */ new Set();
  return n.reduce((h, m) => ([m.markerStart || r, m.markerEnd || o].forEach((v) => {
    if (v && typeof v == "object") {
      const y = vp(v, a);
      f.has(y) || (h.push({ id: y, color: v.color || s, ...v }), f.add(y));
    }
  }), h), []).sort((h, m) => h.id.localeCompare(m.id));
}
const ES = 1e3, HA = 10, Zp = {
  nodeOrigin: [0, 0],
  nodeExtent: jc,
  elevateNodesOnSelect: !0,
  zIndexMode: "basic",
  defaults: {}
}, LA = {
  ...Zp,
  checkEquality: !0
};
function Qp(n, a) {
  const s = { ...n };
  for (const r in a)
    a[r] !== void 0 && (s[r] = a[r]);
  return s;
}
function UA(n, a, s) {
  const r = Qp(Zp, s);
  for (const o of n.values())
    if (o.parentId)
      Pp(o, n, a, r);
    else {
      const f = Bc(o, r.nodeOrigin), h = nr(o.extent) ? o.extent : r.nodeExtent, m = tr(f, h, $a(o));
      o.internals.positionAbsolute = m;
    }
}
function BA(n, a) {
  if (!n.handles)
    return n.measured ? a?.internals.handleBounds : void 0;
  const s = [], r = [];
  for (const o of n.handles) {
    const f = {
      id: o.id,
      width: o.width ?? 1,
      height: o.height ?? 1,
      nodeId: n.id,
      x: o.x,
      y: o.y,
      position: o.position,
      type: o.type
    };
    o.type === "source" ? s.push(f) : o.type === "target" && r.push(f);
  }
  return {
    source: s,
    target: r
  };
}
function Kp(n) {
  return n === "manual";
}
function xp(n, a, s, r = {}) {
  const o = Qp(LA, r), f = { i: 0 }, h = new Map(a), m = o?.elevateNodesOnSelect && !Kp(o.zIndexMode) ? ES : 0;
  let v = n.length > 0, y = !1;
  a.clear(), s.clear();
  for (const g of n) {
    let p = h.get(g.id);
    if (o.checkEquality && g === p?.internals.userNode)
      a.set(g.id, p);
    else {
      const S = Bc(g, o.nodeOrigin), w = nr(g.extent) ? g.extent : o.nodeExtent, E = tr(S, w, $a(g));
      p = {
        ...o.defaults,
        ...g,
        measured: {
          width: g.measured?.width,
          height: g.measured?.height
        },
        internals: {
          positionAbsolute: E,
          // if user re-initializes the node or removes `measured` for whatever reason, we reset the handleBounds so that the node gets re-measured
          handleBounds: BA(g, p),
          z: NS(g, m, o.zIndexMode),
          userNode: g
        }
      }, a.set(g.id, p);
    }
    (p.measured === void 0 || p.measured.width === void 0 || p.measured.height === void 0) && !p.hidden && (v = !1), g.parentId && Pp(p, a, s, r, f), y ||= g.selected ?? !1;
  }
  return { nodesInitialized: v, hasSelectedNodes: y };
}
function $A(n, a) {
  if (!n.parentId)
    return;
  const s = a.get(n.parentId);
  s ? s.set(n.id, n) : a.set(n.parentId, /* @__PURE__ */ new Map([[n.id, n]]));
}
function Pp(n, a, s, r, o) {
  const { elevateNodesOnSelect: f, nodeOrigin: h, nodeExtent: m, zIndexMode: v } = Qp(Zp, r), y = n.parentId, g = a.get(y);
  if (!g) {
    console.warn(`Parent node ${y} not found. Please make sure that parent nodes are in front of their child nodes in the nodes array.`);
    return;
  }
  $A(n, s), o && !g.parentId && g.internals.rootParentIndex === void 0 && v === "auto" && (g.internals.rootParentIndex = ++o.i, g.internals.z = g.internals.z + o.i * HA), o && g.internals.rootParentIndex !== void 0 && (o.i = g.internals.rootParentIndex);
  const p = f && !Kp(v) ? ES : 0, { x: S, y: w, z: E } = qA(n, g, h, m, p, v), { positionAbsolute: N } = n.internals, _ = S !== N.x || w !== N.y;
  (_ || E !== n.internals.z) && a.set(n.id, {
    ...n,
    internals: {
      ...n.internals,
      positionAbsolute: _ ? { x: S, y: w } : N,
      z: E
    }
  });
}
function NS(n, a, s) {
  const r = Da(n.zIndex) ? n.zIndex : 0;
  return Kp(s) ? r : r + (n.selected ? a : 0);
}
function qA(n, a, s, r, o, f) {
  const { x: h, y: m } = a.internals.positionAbsolute, v = $a(n), y = Bc(n, s), g = nr(n.extent) ? tr(y, n.extent, v) : y;
  let p = tr({ x: h + g.x, y: m + g.y }, r, v);
  n.extent === "parent" && (p = uS(p, v, a));
  const S = NS(n, o, f), w = a.internals.z ?? 0;
  return {
    x: p.x,
    y: p.y,
    z: w >= S ? w + 1 : S
  };
}
function Jp(n, a, s, r = [0, 0]) {
  const o = [], f = /* @__PURE__ */ new Map();
  for (const h of n) {
    const m = a.get(h.parentId);
    if (!m)
      continue;
    const v = f.get(h.parentId)?.expandedRect ?? Rc(m), y = fS(v, h.rect);
    f.set(h.parentId, { expandedRect: y, parent: m });
  }
  return f.size > 0 && f.forEach(({ expandedRect: h, parent: m }, v) => {
    const y = m.internals.positionAbsolute, g = $a(m), p = m.origin ?? r, S = h.x < y.x ? Math.round(Math.abs(y.x - h.x)) : 0, w = h.y < y.y ? Math.round(Math.abs(y.y - h.y)) : 0, E = Math.max(g.width, Math.round(h.width)), N = Math.max(g.height, Math.round(h.height)), _ = (E - g.width) * p[0], C = (N - g.height) * p[1];
    (S > 0 || w > 0 || _ || C) && (o.push({
      id: v,
      type: "position",
      position: {
        x: m.position.x - S + _,
        y: m.position.y - w + C
      }
    }), s.get(v)?.forEach((D) => {
      n.some((M) => M.id === D.id) || o.push({
        id: D.id,
        type: "position",
        position: {
          x: D.position.x + S,
          y: D.position.y + w
        }
      });
    })), (g.width < h.width || g.height < h.height || S || w) && o.push({
      id: v,
      type: "dimensions",
      setAttributes: !0,
      dimensions: {
        width: E + (S ? p[0] * S - _ : 0),
        height: N + (w ? p[1] * w - C : 0)
      }
    });
  }), o;
}
function VA(n, a, s, r, o, f, h) {
  const m = r?.querySelector(".xyflow__viewport");
  let v = !1;
  if (!m)
    return { changes: [], updatedInternals: v };
  const y = [], g = window.getComputedStyle(m), { m22: p } = new window.DOMMatrixReadOnly(g.transform), S = [];
  for (const w of n.values()) {
    const E = a.get(w.id);
    if (!E)
      continue;
    if (E.hidden) {
      a.set(E.id, {
        ...E,
        internals: {
          ...E.internals,
          handleBounds: void 0
        }
      }), v = !0;
      continue;
    }
    const N = Gp(w.nodeElement), _ = E.measured.width !== N.width || E.measured.height !== N.height;
    if (!!(N.width && N.height && (_ || !E.internals.handleBounds || w.force))) {
      const D = w.nodeElement.getBoundingClientRect(), M = nr(E.extent) ? E.extent : f;
      let { positionAbsolute: R } = E.internals;
      if (E.parentId && E.extent === "parent") {
        const V = a.get(E.parentId);
        V && (R = uS(R, N, V));
      } else M && (R = tr(R, M, N));
      const Q = {
        ...E,
        measured: N,
        internals: {
          ...E.internals,
          positionAbsolute: R,
          handleBounds: {
            source: Xx("source", w.nodeElement, D, p, E.id),
            target: Xx("target", w.nodeElement, D, p, E.id)
          }
        }
      };
      a.set(E.id, Q), E.parentId && Pp(Q, a, s, { nodeOrigin: o, zIndexMode: h }), v = !0, _ && (y.push({
        id: E.id,
        type: "dimensions",
        dimensions: N
      }), E.expandParent && E.parentId && S.push({
        id: E.id,
        parentId: E.parentId,
        rect: Rc(Q, o)
      }));
    }
  }
  if (S.length > 0) {
    const w = Jp(S, a, s, o);
    y.push(...w);
  }
  return { changes: y, updatedInternals: v };
}
async function YA({ delta: n, panZoom: a, transform: s, translateExtent: r, width: o, height: f }) {
  if (!a || !n.x && !n.y)
    return !1;
  const h = await a.setViewportConstrained({
    x: s[0] + n.x,
    y: s[1] + n.y,
    zoom: s[2]
  }, [
    [0, 0],
    [o, f]
  ], r);
  return !!h && (h.x !== s[0] || h.y !== s[1] || h.k !== s[2]);
}
function Fx(n, a, s, r, o, f) {
  let h = o;
  const m = r.get(h) || /* @__PURE__ */ new Map();
  r.set(h, m.set(s, a)), h = `${o}-${n}`;
  const v = r.get(h) || /* @__PURE__ */ new Map();
  if (r.set(h, v.set(s, a)), f) {
    h = `${o}-${n}-${f}`;
    const y = r.get(h) || /* @__PURE__ */ new Map();
    r.set(h, y.set(s, a));
  }
}
function TS(n, a, s) {
  n.clear(), a.clear();
  for (const r of s) {
    const { source: o, target: f, sourceHandle: h = null, targetHandle: m = null } = r, v = { edgeId: r.id, source: o, target: f, sourceHandle: h, targetHandle: m }, y = `${o}-${h}--${f}-${m}`, g = `${f}-${m}--${o}-${h}`;
    Fx("source", v, g, n, o, h), Fx("target", v, y, n, f, m), a.set(r.id, r);
  }
}
function CS(n, a) {
  if (!n.parentId)
    return !1;
  const s = a.get(n.parentId);
  return s ? s.selected ? !0 : CS(s, a) : !1;
}
function Wx(n, a, s) {
  let r = n;
  do {
    if (r?.matches?.(a))
      return !0;
    if (r === s)
      return !1;
    r = r?.parentElement;
  } while (r);
  return !1;
}
function IA(n, a, s, r, o) {
  const f = /* @__PURE__ */ new Map();
  for (const [h, m] of n)
    if ((o ? m.id === r : m.selected || m.id === r) && (o || !m.parentId || !CS(m, n)) && (m.draggable || a && typeof m.draggable > "u")) {
      const y = n.get(h);
      y && f.set(h, {
        id: h,
        position: y.position || { x: 0, y: 0 },
        distance: {
          x: s.x - y.internals.positionAbsolute.x,
          y: s.y - y.internals.positionAbsolute.y
        },
        extent: y.extent,
        parentId: y.parentId,
        origin: y.origin,
        expandParent: y.expandParent,
        internals: {
          positionAbsolute: y.internals.positionAbsolute || { x: 0, y: 0 }
        },
        measured: {
          width: y.measured.width ?? 0,
          height: y.measured.height ?? 0
        }
      });
    }
  return f;
}
function Dm({ nodeId: n, dragItems: a, nodeLookup: s, dragging: r = !0 }) {
  const o = [];
  for (const [h, m] of a) {
    const v = s.get(h)?.internals.userNode;
    v && o.push({
      ...v,
      position: m.position,
      dragging: r
    });
  }
  if (!n)
    return [o[0], o];
  const f = s.get(n)?.internals.userNode;
  return [
    f ? {
      ...f,
      position: a.get(n)?.position || f.position,
      dragging: r
    } : o[0],
    o
  ];
}
function XA({ dragItems: n, snapGrid: a, x: s, y: r }) {
  const o = n.values().next().value;
  if (!o)
    return null;
  const f = {
    x: s - o.distance.x,
    y: r - o.distance.y
  }, h = qc(f, a);
  return {
    x: h.x - f.x,
    y: h.y - f.y
  };
}
function GA({ onNodeMouseDown: n, getStoreItems: a, onDragStart: s, onDrag: r, onDragStop: o }) {
  let f = { x: null, y: null }, h = 0, m = /* @__PURE__ */ new Map(), v = !1, y = { x: 0, y: 0 }, g = null, p = !1, S = null, w = !1, E = !1, N = null;
  function _({ noDragClassName: D, handleSelector: M, domNode: R, isSelectable: Q, nodeId: V, nodeClickDistance: k = 0 }) {
    S = Fi(R);
    function H({ x: me, y: te }) {
      const { nodeLookup: O, nodeExtent: Y, snapGrid: j, snapToGrid: B, nodeOrigin: X, onNodeDrag: J, onSelectionDrag: I, onError: ae, updateNodePositions: he } = a();
      f = { x: me, y: te };
      let Ee = !1;
      const L = m.size > 1, ce = L && Y ? gp($c(m)) : null, pe = L && B ? XA({
        dragItems: m,
        snapGrid: j,
        x: me,
        y: te
      }) : null;
      for (const [Se, le] of m) {
        if (!O.has(Se))
          continue;
        let Te = { x: me - le.distance.x, y: te - le.distance.y };
        B && (Te = pe ? {
          x: Math.round(Te.x + pe.x),
          y: Math.round(Te.y + pe.y)
        } : qc(Te, j));
        let Ce = null;
        if (L && Y && !le.extent && ce) {
          const { positionAbsolute: ze } = le.internals, Ve = ze.x - ce.x + Y[0][0], $e = ze.x + le.measured.width - ce.x2 + Y[1][0], Me = ze.y - ce.y + Y[0][1], Ge = ze.y + le.measured.height - ce.y2 + Y[1][1];
          Ce = [
            [Ve, Me],
            [$e, Ge]
          ];
        }
        const { position: we, positionAbsolute: Ne } = cS({
          nodeId: Se,
          nextPosition: Te,
          nodeLookup: O,
          nodeExtent: Ce || Y,
          nodeOrigin: X,
          onError: ae
        });
        Ee = Ee || le.position.x !== we.x || le.position.y !== we.y, le.position = we, le.internals.positionAbsolute = Ne;
      }
      if (E = E || Ee, !!Ee && (he(m, !0), N && (r || J || !V && I))) {
        const [Se, le] = Dm({
          nodeId: V,
          dragItems: m,
          nodeLookup: O
        });
        r?.(N, m, Se, le), J?.(N, Se, le), V || I?.(N, le);
      }
    }
    async function q() {
      if (!g)
        return;
      const { transform: me, panBy: te, autoPanSpeed: O, autoPanOnNodeDrag: Y } = a();
      if (!Y) {
        v = !1, cancelAnimationFrame(h);
        return;
      }
      const [j, B] = Ip(y, g, O);
      (j !== 0 || B !== 0) && (f.x = (f.x ?? 0) - j / me[2], f.y = (f.y ?? 0) - B / me[2], await te({ x: j, y: B }) && H(f)), h = requestAnimationFrame(q);
    }
    function de(me) {
      const { nodeLookup: te, multiSelectionActive: O, nodesDraggable: Y, transform: j, snapGrid: B, snapToGrid: X, selectNodesOnDrag: J, onNodeDragStart: I, onSelectionDragStart: ae, unselectNodesAndEdges: he } = a();
      p = !0;
      const Ee = !!V && !O && !te.get(V)?.selected;
      (!J || !Q) && !O && V && (te.get(V)?.selected || he()), Q && J && V && n?.(V);
      const L = Tc(me.sourceEvent, { transform: j, snapGrid: B, snapToGrid: X, containerBounds: g });
      if (f = L, m = IA(te, Y, L, V, Ee), m.size > 0 && (s || I || !V && ae)) {
        const [ce, pe] = Dm({
          nodeId: V,
          dragItems: m,
          nodeLookup: te
        });
        s?.(me.sourceEvent, m, ce, pe), I?.(me.sourceEvent, ce, pe), V || ae?.(me.sourceEvent, pe);
      }
    }
    const ee = Rb().clickDistance(k).on("start", (me) => {
      const { domNode: te, nodeDragThreshold: O, transform: Y, snapGrid: j, snapToGrid: B } = a();
      g = te?.getBoundingClientRect() || null, w = !1, E = !1, N = me.sourceEvent, O === 0 && de(me), f = Tc(me.sourceEvent, { transform: Y, snapGrid: j, snapToGrid: B, containerBounds: g }), y = Ha(me.sourceEvent, g);
    }).on("drag", (me) => {
      const { autoPanOnNodeDrag: te, transform: O, snapGrid: Y, snapToGrid: j, nodeDragThreshold: B, nodeLookup: X } = a(), J = Tc(me.sourceEvent, { transform: O, snapGrid: Y, snapToGrid: j, containerBounds: g });
      if (N = me.sourceEvent, (me.sourceEvent.type === "touchmove" && me.sourceEvent.touches.length > 1 || // if user deletes a node while dragging, we need to abort the drag to prevent errors
      V && !X.has(V)) && (w = !0), !w) {
        if (!v && te && p && (v = !0, q()), !p) {
          const I = Ha(me.sourceEvent, g), ae = I.x - y.x, he = I.y - y.y;
          Math.sqrt(ae * ae + he * he) > B && de(me);
        }
        (f.x !== J.xSnapped || f.y !== J.ySnapped) && m && p && (y = Ha(me.sourceEvent, g), H(J));
      }
    }).on("end", (me) => {
      if (!p || w) {
        w && m.size > 0 && a().updateNodePositions(m, !1);
        return;
      }
      if (v = !1, p = !1, cancelAnimationFrame(h), m.size > 0) {
        const { nodeLookup: te, updateNodePositions: O, onNodeDragStop: Y, onSelectionDragStop: j } = a();
        if (E && (O(m, !1), E = !1), o || Y || !V && j) {
          const [B, X] = Dm({
            nodeId: V,
            dragItems: m,
            nodeLookup: te,
            dragging: !1
          });
          o?.(me.sourceEvent, m, B, X), Y?.(me.sourceEvent, B, X), V || j?.(me.sourceEvent, X);
        }
      }
    }).filter((me) => {
      const te = me.target;
      return !me.button && (!D || !Wx(te, `.${D}`, R)) && (!M || Wx(te, M, R));
    });
    S.call(ee);
  }
  function C() {
    S?.on(".drag", null);
  }
  return {
    update: _,
    destroy: C
  };
}
function ZA(n, a, s) {
  const r = [], o = {
    x: n.x - s,
    y: n.y - s,
    width: s * 2,
    height: s * 2
  };
  for (const f of a.values())
    Bf(o, Rc(f)) > 0 && r.push(f);
  return r;
}
const QA = 250;
function KA(n, a, s, r) {
  let o = [], f = 1 / 0;
  const h = ZA(n, s, a + QA);
  for (const m of h) {
    const v = [...m.internals.handleBounds?.source ?? [], ...m.internals.handleBounds?.target ?? []];
    for (const y of v) {
      if (r.nodeId === y.nodeId && r.type === y.type && r.id === y.id)
        continue;
      const { x: g, y: p } = ir(m, y, y.position, !0), S = Math.sqrt(Math.pow(g - n.x, 2) + Math.pow(p - n.y, 2));
      S > a || (S < f ? (o = [{ ...y, x: g, y: p }], f = S) : S === f && o.push({ ...y, x: g, y: p }));
    }
  }
  if (!o.length)
    return null;
  if (o.length > 1) {
    const m = r.type === "source" ? "target" : "source";
    return o.find((v) => v.type === m) ?? o[0];
  }
  return o[0];
}
function AS(n, a, s, r, o, f = !1) {
  const h = r.get(n);
  if (!h)
    return null;
  const m = o === "strict" ? h.internals.handleBounds?.[a] : [...h.internals.handleBounds?.source ?? [], ...h.internals.handleBounds?.target ?? []], v = (s ? m?.find((y) => y.id === s) : m?.[0]) ?? null;
  return v && f ? { ...v, ...ir(h, v, v.position, !0) } : v;
}
function MS(n, a) {
  return n || (a?.classList.contains("target") ? "target" : a?.classList.contains("source") ? "source" : null);
}
function PA(n, a) {
  let s = null;
  return a ? s = !0 : n && !a && (s = !1), s;
}
const zS = () => !0;
function JA(n, { connectionMode: a, connectionRadius: s, handleId: r, nodeId: o, edgeUpdaterType: f, isTarget: h, domNode: m, nodeLookup: v, lib: y, autoPanOnConnect: g, flowId: p, panBy: S, cancelConnection: w, onConnectStart: E, onConnect: N, onConnectEnd: _, isValidConnection: C = zS, onReconnectEnd: D, updateConnection: M, getTransform: R, getFromHandle: Q, autoPanSpeed: V, dragThreshold: k = 1, handleDomNode: H }) {
  const q = yS(n.target);
  let de = 0, ee;
  const { x: me, y: te } = Ha(n), O = MS(f, H), Y = m?.getBoundingClientRect();
  let j = !1;
  if (!Y || !O)
    return;
  const B = AS(o, O, r, v, a);
  if (!B)
    return;
  let X = Ha(n, Y), J = !1, I = null, ae = !1, he = null;
  function Ee() {
    if (!g || !Y)
      return;
    const [we, Ne] = Ip(X, Y, V);
    S({ x: we, y: Ne }), de = requestAnimationFrame(Ee);
  }
  const L = {
    ...B,
    nodeId: o,
    type: O,
    position: B.position
  }, ce = v.get(o);
  let Se = {
    inProgress: !0,
    isValid: null,
    from: ir(ce, L, Ue.Left, !0),
    fromHandle: L,
    fromPosition: L.position,
    fromNode: ce,
    to: X,
    toHandle: null,
    toPosition: qx[L.position],
    toNode: null,
    pointer: X
  };
  function le() {
    j = !0, M(Se), E?.(n, { nodeId: o, handleId: r, handleType: O });
  }
  k === 0 && le();
  function Te(we) {
    if (!j) {
      const { x: Ge, y: Re } = Ha(we), _t = Ge - me, it = Re - te;
      if (!(_t * _t + it * it > k * k))
        return;
      le();
    }
    if (!Q() || !L) {
      Ce(we);
      return;
    }
    const Ne = R();
    X = Ha(we, Y), ee = KA(Vc(X, Ne, !1, [1, 1]), s, v, L), J || (Ee(), J = !0);
    const ze = kS(we, {
      handle: ee,
      connectionMode: a,
      fromNodeId: o,
      fromHandleId: r,
      fromType: h ? "target" : "source",
      isValidConnection: C,
      doc: q,
      lib: y,
      flowId: p,
      nodeLookup: v
    });
    he = ze.handleDomNode, I = ze.connection, ae = PA(!!ee, ze.isValid);
    const Ve = v.get(o), $e = Ve ? ir(Ve, L, Ue.Left, !0) : Se.from, Me = {
      ...Se,
      from: $e,
      isValid: ae,
      to: ze.toHandle && ae ? mo({ x: ze.toHandle.x, y: ze.toHandle.y }, Ne) : X,
      toHandle: ze.toHandle,
      toPosition: ae && ze.toHandle ? ze.toHandle.position : qx[L.position],
      toNode: ze.toHandle ? v.get(ze.toHandle.nodeId) : null,
      pointer: X
    };
    M(Me), Se = Me;
  }
  function Ce(we) {
    if (!("touches" in we && we.touches.length > 0)) {
      if (j) {
        (ee || he) && I && ae && N?.(I);
        const { inProgress: Ne, ...ze } = Se, Ve = {
          ...ze,
          toPosition: Se.toHandle ? Se.toPosition : null
        };
        _?.(we, Ve), f && D?.(we, Ve);
      }
      w(), cancelAnimationFrame(de), J = !1, ae = !1, I = null, he = null, q.removeEventListener("mousemove", Te), q.removeEventListener("mouseup", Ce), q.removeEventListener("touchmove", Te), q.removeEventListener("touchend", Ce);
    }
  }
  q.addEventListener("mousemove", Te), q.addEventListener("mouseup", Ce), q.addEventListener("touchmove", Te), q.addEventListener("touchend", Ce);
}
function kS(n, { handle: a, connectionMode: s, fromNodeId: r, fromHandleId: o, fromType: f, doc: h, lib: m, flowId: v, isValidConnection: y = zS, nodeLookup: g }) {
  const p = f === "target", S = a ? h.querySelector(`.${m}-flow__handle[data-id="${v}-${a?.nodeId}-${a?.id}-${a?.type}"]`) : null, { x: w, y: E } = Ha(n), N = h.elementFromPoint(w, E), _ = N?.classList.contains(`${m}-flow__handle`) ? N : S, C = {
    handleDomNode: _,
    isValid: !1,
    connection: null,
    toHandle: null
  };
  if (_) {
    const D = MS(void 0, _), M = _.getAttribute("data-nodeid"), R = _.getAttribute("data-handleid"), Q = _.classList.contains("connectable"), V = _.classList.contains("connectableend");
    if (!M || !D)
      return C;
    const k = {
      source: p ? M : r,
      sourceHandle: p ? R : o,
      target: p ? r : M,
      targetHandle: p ? o : R
    };
    C.connection = k;
    const q = Q && V && (s === uo.Strict ? p && D === "source" || !p && D === "target" : M !== r || R !== o);
    C.isValid = q && y(k), C.toHandle = AS(M, D, R, g, s, !0);
  }
  return C;
}
const bp = {
  onPointerDown: JA,
  isValid: kS
};
function FA({ domNode: n, panZoom: a, getTransform: s, getViewScale: r }) {
  const o = Fi(n);
  function f({ translateExtent: m, width: v, height: y, zoomStep: g = 1, pannable: p = !0, zoomable: S = !0, inversePan: w = !1 }) {
    const E = (M) => {
      if (M.sourceEvent.type !== "wheel" || !a)
        return;
      const R = s(), Q = M.sourceEvent.ctrlKey && Oc() ? 10 : 1, V = -M.sourceEvent.deltaY * (M.sourceEvent.deltaMode === 1 ? 0.05 : M.sourceEvent.deltaMode ? 1 : 2e-3) * g, k = R[2] * Math.pow(2, V * Q);
      a.scaleTo(k);
    };
    let N = [0, 0];
    const _ = (M) => {
      (M.sourceEvent.type === "mousedown" || M.sourceEvent.type === "touchstart") && (N = [
        M.sourceEvent.clientX ?? M.sourceEvent.touches[0].clientX,
        M.sourceEvent.clientY ?? M.sourceEvent.touches[0].clientY
      ]);
    }, C = (M) => {
      const R = s();
      if (M.sourceEvent.type !== "mousemove" && M.sourceEvent.type !== "touchmove" || !a)
        return;
      const Q = [
        M.sourceEvent.clientX ?? M.sourceEvent.touches[0].clientX,
        M.sourceEvent.clientY ?? M.sourceEvent.touches[0].clientY
      ], V = [Q[0] - N[0], Q[1] - N[1]];
      N = Q;
      const k = r() * Math.max(R[2], Math.log(R[2])) * (w ? -1 : 1), H = {
        x: R[0] - V[0] * k,
        y: R[1] - V[1] * k
      }, q = [
        [0, 0],
        [v, y]
      ];
      a.setViewportConstrained({
        x: H.x,
        y: H.y,
        zoom: R[2]
      }, q, m);
    }, D = aS().on("start", _).on("zoom", p ? C : null).on("zoom.wheel", S ? E : null);
    o.call(D, {});
  }
  function h() {
    o.on("zoom", null);
  }
  return {
    update: f,
    destroy: h,
    pointer: ka
  };
}
const ed = (n) => ({
  x: n.x,
  y: n.y,
  zoom: n.k
}), Hm = ({ x: n, y: a, zoom: s }) => Jf.translate(n, a).scale(s), ms = (n, a) => n.target.closest(`.${a}`), jS = (n, a) => a === 2 && Array.isArray(n) && n.includes(2), WA = (n) => ((n *= 2) <= 1 ? n * n * n : (n -= 2) * n * n + 2) / 2, Lm = (n, a = 0, s = WA, r = () => {
}) => {
  const o = typeof a == "number" && a > 0;
  return o || r(), o ? n.transition().duration(a).ease(s).on("end", r) : n;
}, RS = (n) => {
  const a = n.ctrlKey && Oc() ? 10 : 1;
  return -n.deltaY * (n.deltaMode === 1 ? 0.05 : n.deltaMode ? 1 : 2e-3) * a;
};
function eM({ zoomPanValues: n, noWheelClassName: a, d3Selection: s, d3Zoom: r, panOnScrollMode: o, panOnScrollSpeed: f, zoomOnPinch: h, onPanZoomStart: m, onPanZoom: v, onPanZoomEnd: y }) {
  return (g) => {
    if (ms(g, a))
      return g.ctrlKey && g.preventDefault(), !1;
    g.preventDefault(), g.stopImmediatePropagation();
    const p = s.property("__zoom").k || 1;
    if (g.ctrlKey && h) {
      const _ = ka(g), C = RS(g), D = p * Math.pow(2, C);
      r.scaleTo(s, D, _, g);
      return;
    }
    const S = g.deltaMode === 1 ? 20 : 1;
    let w = o === Js.Vertical ? 0 : g.deltaX * S, E = o === Js.Horizontal ? 0 : g.deltaY * S;
    !Oc() && g.shiftKey && o !== Js.Vertical && (w = g.deltaY * S, E = 0), r.translateBy(
      s,
      -(w / p) * f,
      -(E / p) * f,
      // @ts-ignore
      { internal: !0 }
    );
    const N = ed(s.property("__zoom"));
    clearTimeout(n.panScrollTimeout), n.isPanScrolling ? v?.(g, N) : (n.isPanScrolling = !0, m?.(g, N)), n.panScrollTimeout = setTimeout(() => {
      y?.(g, N), n.isPanScrolling = !1;
    }, 150);
  };
}
function tM({ noWheelClassName: n, preventScrolling: a, d3ZoomHandler: s }) {
  return function(r, o) {
    const f = r.type === "wheel", h = !a && f && !r.ctrlKey, m = ms(r, n);
    if (r.ctrlKey && f && m && r.preventDefault(), h || m)
      return null;
    r.preventDefault(), s.call(this, r, o);
  };
}
function nM({ zoomPanValues: n, onDraggingChange: a, onPanZoomStart: s }) {
  return (r) => {
    if (r.sourceEvent?.internal)
      return;
    const o = ed(r.transform);
    n.mouseButton = r.sourceEvent?.button || 0, n.isZoomingOrPanning = !0, n.prevViewport = o, r.sourceEvent?.type === "mousedown" && a(!0), s && s?.(r.sourceEvent, o);
  };
}
function iM({ zoomPanValues: n, panOnDrag: a, onPaneContextMenu: s, onTransformChange: r, onPanZoom: o }) {
  return (f) => {
    n.usedRightMouseButton = !!(s && jS(a, n.mouseButton ?? 0)), f.sourceEvent?.sync || r([f.transform.x, f.transform.y, f.transform.k]), o && !f.sourceEvent?.internal && o?.(f.sourceEvent, ed(f.transform));
  };
}
function aM({ zoomPanValues: n, panOnDrag: a, panOnScroll: s, onDraggingChange: r, onPanZoomEnd: o, onPaneContextMenu: f }) {
  return (h) => {
    if (!h.sourceEvent?.internal && (n.isZoomingOrPanning = !1, f && jS(a, n.mouseButton ?? 0) && !n.usedRightMouseButton && h.sourceEvent && f(h.sourceEvent), n.usedRightMouseButton = !1, r(!1), o)) {
      const m = ed(h.transform);
      n.prevViewport = m, clearTimeout(n.timerId), n.timerId = setTimeout(
        () => {
          o?.(h.sourceEvent, m);
        },
        // we need a setTimeout for panOnScroll to suppress multiple end events fired during scroll
        s ? 150 : 0
      );
    }
  };
}
function lM({ panActivationKeyPressed: n, zoomActivationKeyPressed: a, zoomOnScroll: s, zoomOnPinch: r, panOnDrag: o, panOnScroll: f, zoomOnDoubleClick: h, userSelectionActive: m, noWheelClassName: v, noPanClassName: y, lib: g, connectionInProgress: p }) {
  return (S) => {
    const w = a || s, E = r && S.ctrlKey, N = S.type === "wheel";
    if (S.button === 1 && S.type === "mousedown" && (ms(S, `${g}-flow__node`) || ms(S, `${g}-flow__edge`) || ms(S, `${g}-flow__selection`) || ms(S, `${g}-flow__nodesselection`)))
      return !0;
    if (!o && !w && !f && !h && !r || m || p && !N || ms(S, v) && N || ms(S, y) && (!N || f && N && !a) || !r && S.ctrlKey && N)
      return !1;
    if (!r && S.type === "touchstart" && S.touches?.length > 1)
      return S.preventDefault(), !1;
    if (!w && !f && !E && N || !o && (S.type === "mousedown" || S.type === "touchstart") || Array.isArray(o) && !o.includes(S.button) && S.type === "mousedown")
      return !1;
    const _ = Array.isArray(o) && o.includes(S.button) || !S.button || S.button <= 1;
    return (!S.ctrlKey || N || n) && _;
  };
}
function sM({ domNode: n, minZoom: a, maxZoom: s, translateExtent: r, viewport: o, onPanZoom: f, onPanZoomStart: h, onPanZoomEnd: m, onDraggingChange: v }) {
  const y = {
    isZoomingOrPanning: !1,
    usedRightMouseButton: !1,
    prevViewport: {},
    mouseButton: 0,
    timerId: void 0,
    panScrollTimeout: void 0,
    isPanScrolling: !1
  }, g = n.getBoundingClientRect();
  let p = [
    [0, 0],
    [g.width, g.height]
  ];
  const S = typeof ResizeObserver < "u" ? new ResizeObserver((te) => {
    const O = te[0];
    O?.contentRect && (p = [
      [0, 0],
      [O.contentRect.width, O.contentRect.height]
    ]);
  }) : null;
  S?.observe(n);
  const w = aS().extent(() => p).scaleExtent([a, s]).translateExtent(r), E = Fi(n).call(w);
  R({
    x: o.x,
    y: o.y,
    zoom: ho(o.zoom, a, s)
  }, [
    [0, 0],
    [g.width, g.height]
  ], r);
  const N = E.on("wheel.zoom"), _ = E.on("dblclick.zoom");
  w.wheelDelta(RS);
  async function C(te, O) {
    return E ? new Promise((Y) => {
      w?.interpolate(O?.interpolate === "linear" ? Nc : Sf).transform(Lm(E, O?.duration, O?.ease, () => Y(!0)), te);
    }) : !1;
  }
  function D({ noWheelClassName: te, noPanClassName: O, onPaneContextMenu: Y, userSelectionActive: j, panOnScroll: B, panOnDrag: X, panOnScrollMode: J, panOnScrollSpeed: I, preventScrolling: ae, zoomOnPinch: he, zoomOnScroll: Ee, zoomOnDoubleClick: L, panActivationKeyPressed: ce = !1, zoomActivationKeyPressed: pe, lib: Se, onTransformChange: le, connectionInProgress: Te, paneClickDistance: Ce, selectionOnDrag: we }) {
    j && !y.isZoomingOrPanning && w.on("zoom", null);
    const Ne = B && !pe && !j;
    w.clickDistance(we ? 1 / 0 : !Da(Ce) || Ce < 0 ? 0 : Ce);
    const ze = Ne ? eM({
      zoomPanValues: y,
      noWheelClassName: te,
      d3Selection: E,
      d3Zoom: w,
      panOnScrollMode: J,
      panOnScrollSpeed: I,
      zoomOnPinch: he,
      onPanZoomStart: h,
      onPanZoom: f,
      onPanZoomEnd: m
    }) : tM({
      noWheelClassName: te,
      preventScrolling: ae,
      d3ZoomHandler: N
    });
    E.on("wheel.zoom", ze, { passive: !1 });
    const Ve = nM({
      zoomPanValues: y,
      onDraggingChange: v,
      onPanZoomStart: h
    });
    w.on("start", Ve);
    const $e = iM({
      zoomPanValues: y,
      panOnDrag: X,
      onPaneContextMenu: !!Y,
      onPanZoom: f,
      onTransformChange: le
    });
    w.on("zoom", $e);
    const Me = aM({
      zoomPanValues: y,
      panOnDrag: X,
      panOnScroll: B,
      onPaneContextMenu: Y,
      onPanZoomEnd: m,
      onDraggingChange: v
    });
    w.on("end", Me);
    const Ge = lM({
      panActivationKeyPressed: ce,
      zoomActivationKeyPressed: pe,
      panOnDrag: X,
      zoomOnScroll: Ee,
      panOnScroll: B,
      zoomOnDoubleClick: L,
      zoomOnPinch: he,
      userSelectionActive: j,
      noPanClassName: O,
      noWheelClassName: te,
      lib: Se,
      connectionInProgress: Te
    });
    w.filter(Ge), L ? E.on("dblclick.zoom", _) : E.on("dblclick.zoom", null);
  }
  function M() {
    w.on("zoom", null), S?.disconnect();
  }
  async function R(te, O, Y) {
    const j = Hm(te), B = w?.constrain()(j, O, Y);
    return B && await C(B), B;
  }
  async function Q(te, O) {
    const Y = Hm(te);
    return await C(Y, O), Y;
  }
  function V(te) {
    if (E) {
      const O = Hm(te), Y = E.property("__zoom");
      (Y.k !== te.zoom || Y.x !== te.x || Y.y !== te.y) && w?.transform(E, O, null, { sync: !0 });
    }
  }
  function k() {
    const te = E ? iS(E.node()) : { x: 0, y: 0, k: 1 };
    return { x: te.x, y: te.y, zoom: te.k };
  }
  async function H(te, O) {
    return E ? new Promise((Y) => {
      w?.interpolate(O?.interpolate === "linear" ? Nc : Sf).scaleTo(Lm(E, O?.duration, O?.ease, () => Y(!0)), te);
    }) : !1;
  }
  async function q(te, O) {
    return E ? new Promise((Y) => {
      w?.interpolate(O?.interpolate === "linear" ? Nc : Sf).scaleBy(Lm(E, O?.duration, O?.ease, () => Y(!0)), te);
    }) : !1;
  }
  function de(te) {
    w?.scaleExtent(te);
  }
  function ee(te) {
    w?.translateExtent(te);
  }
  function me(te) {
    const O = !Da(te) || te < 0 ? 0 : te;
    w?.clickDistance(O);
  }
  return {
    update: D,
    destroy: M,
    setViewport: Q,
    setViewportConstrained: R,
    getViewport: k,
    scaleTo: H,
    scaleBy: q,
    setScaleExtent: de,
    setTranslateExtent: ee,
    syncViewport: V,
    setClickDistance: me
  };
}
var ar;
(function(n) {
  n.Line = "line", n.Handle = "handle";
})(ar || (ar = {}));
const rM = ["top-left", "top-right", "bottom-left", "bottom-right"], oM = ["top", "right", "bottom", "left"];
function cM({ width: n, prevWidth: a, height: s, prevHeight: r, affectsX: o, affectsY: f }) {
  const h = n - a, m = s - r, v = [h > 0 ? 1 : h < 0 ? -1 : 0, m > 0 ? 1 : m < 0 ? -1 : 0];
  return h && o && (v[0] = v[0] * -1), m && f && (v[1] = v[1] * -1), v;
}
function e1(n) {
  const a = n.includes("right") || n.includes("left"), s = n.includes("bottom") || n.includes("top"), r = n.includes("left"), o = n.includes("top");
  return {
    isHorizontal: a,
    isVertical: s,
    affectsX: r,
    affectsY: o
  };
}
function os(n, a) {
  return Math.max(0, a - n);
}
function cs(n, a) {
  return Math.max(0, n - a);
}
function df(n, a, s) {
  return Math.max(0, a - n, n - s);
}
function t1(n, a) {
  return n ? !a : a;
}
function uM(n, a, s, r, o, f, h, m) {
  let { affectsX: v, affectsY: y } = a;
  const { isHorizontal: g, isVertical: p } = a, S = g && p, { xSnapped: w, ySnapped: E } = s, { minWidth: N, maxWidth: _, minHeight: C, maxHeight: D } = r, { x: M, y: R, width: Q, height: V, aspectRatio: k } = n;
  let H = Math.floor(g ? w - n.pointerX : 0), q = Math.floor(p ? E - n.pointerY : 0);
  const de = Q + (v ? -H : H), ee = V + (y ? -q : q), me = -f[0] * Q, te = -f[1] * V;
  let O = df(de, N, _), Y = df(ee, C, D);
  if (h) {
    let X = 0, J = 0;
    v && H < 0 ? X = os(M + H + me, h[0][0]) : !v && H > 0 && (X = cs(M + de + me, h[1][0])), y && q < 0 ? J = os(R + q + te, h[0][1]) : !y && q > 0 && (J = cs(R + ee + te, h[1][1])), O = Math.max(O, X), Y = Math.max(Y, J);
  }
  if (m) {
    let X = 0, J = 0;
    v && H > 0 ? X = cs(M + H, m[0][0]) : !v && H < 0 && (X = os(M + de, m[1][0])), y && q > 0 ? J = cs(R + q, m[0][1]) : !y && q < 0 && (J = os(R + ee, m[1][1])), O = Math.max(O, X), Y = Math.max(Y, J);
  }
  if (o) {
    if (g) {
      const X = df(de / k, C, D) * k;
      if (O = Math.max(O, X), h) {
        let J = 0;
        !v && !y || v && !y && S ? J = cs(R + te + de / k, h[1][1]) * k : J = os(R + te + (v ? H : -H) / k, h[0][1]) * k, O = Math.max(O, J);
      }
      if (m) {
        let J = 0;
        !v && !y || v && !y && S ? J = os(R + de / k, m[1][1]) * k : J = cs(R + (v ? H : -H) / k, m[0][1]) * k, O = Math.max(O, J);
      }
    }
    if (p) {
      const X = df(ee * k, N, _) / k;
      if (Y = Math.max(Y, X), h) {
        let J = 0;
        !v && !y || y && !v && S ? J = cs(M + ee * k + me, h[1][0]) / k : J = os(M + (y ? q : -q) * k + me, h[0][0]) / k, Y = Math.max(Y, J);
      }
      if (m) {
        let J = 0;
        !v && !y || y && !v && S ? J = os(M + ee * k, m[1][0]) / k : J = cs(M + (y ? q : -q) * k, m[0][0]) / k, Y = Math.max(Y, J);
      }
    }
  }
  q = q + (q < 0 ? Y : -Y), H = H + (H < 0 ? O : -O), o && (S ? de > ee * k ? q = (t1(v, y) ? -H : H) / k : H = (t1(v, y) ? -q : q) * k : g ? (q = H / k, y = v) : (H = q * k, v = y));
  const j = v ? M + H : M, B = y ? R + q : R;
  return {
    width: Q + (v ? -H : H),
    height: V + (y ? -q : q),
    x: f[0] * H * (v ? -1 : 1) + j,
    y: f[1] * q * (y ? -1 : 1) + B
  };
}
const OS = { width: 0, height: 0, x: 0, y: 0 }, fM = {
  ...OS,
  pointerX: 0,
  pointerY: 0,
  aspectRatio: 1
};
function dM(n, a, s) {
  const r = a.position.x + n.position.x, o = a.position.y + n.position.y, f = n.measured.width ?? 0, h = n.measured.height ?? 0, m = s[0] * f, v = s[1] * h;
  return [
    [r - m, o - v],
    [r + f - m, o + h - v]
  ];
}
function hM({ domNode: n, nodeId: a, getStoreItems: s, onChange: r, onEnd: o }) {
  const f = Fi(n);
  let h = {
    controlDirection: e1("bottom-right"),
    boundaries: {
      minWidth: 0,
      minHeight: 0,
      maxWidth: Number.MAX_VALUE,
      maxHeight: Number.MAX_VALUE
    },
    resizeDirection: void 0,
    keepAspectRatio: !1
  };
  function m({ controlPosition: y, boundaries: g, keepAspectRatio: p, resizeDirection: S, onResizeStart: w, onResize: E, onResizeEnd: N, shouldResize: _ }) {
    let C = { ...OS }, D = { ...fM };
    h = {
      boundaries: g,
      resizeDirection: S,
      keepAspectRatio: p,
      controlDirection: e1(y)
    };
    let M, R = null, Q = [], V, k, H;
    const q = Rb().on("start", (de) => {
      const { nodeLookup: ee, transform: me, snapGrid: te, snapToGrid: O, nodeOrigin: Y, paneDomNode: j } = s();
      if (M = ee.get(a), !M)
        return;
      R = j?.getBoundingClientRect() ?? null;
      const { xSnapped: B, ySnapped: X } = Tc(de.sourceEvent, {
        transform: me,
        snapGrid: te,
        snapToGrid: O,
        containerBounds: R
      });
      C = {
        width: M.measured.width ?? 0,
        height: M.measured.height ?? 0,
        x: M.position.x ?? 0,
        y: M.position.y ?? 0
      }, D = {
        ...C,
        pointerX: B,
        pointerY: X,
        aspectRatio: C.width / C.height
      }, V = void 0, k = nr(M.extent) ? M.extent : void 0, M.parentId && (M.extent === "parent" || M.expandParent) && (V = ee.get(M.parentId)), V && M.extent === "parent" && (k = [
        [0, 0],
        [V.measured.width, V.measured.height]
      ]), Q = [], H = void 0;
      for (const [J, I] of ee)
        if (I.parentId === a && (Q.push({
          id: J,
          position: { ...I.position },
          extent: I.extent
        }), I.extent === "parent" || I.expandParent)) {
          const ae = dM(I, M, I.origin ?? Y);
          H ? H = [
            [Math.min(ae[0][0], H[0][0]), Math.min(ae[0][1], H[0][1])],
            [Math.max(ae[1][0], H[1][0]), Math.max(ae[1][1], H[1][1])]
          ] : H = ae;
        }
      w?.(de, { ...C });
    }).on("drag", (de) => {
      const { transform: ee, snapGrid: me, snapToGrid: te, nodeOrigin: O } = s(), Y = Tc(de.sourceEvent, {
        transform: ee,
        snapGrid: me,
        snapToGrid: te,
        containerBounds: R
      }), j = [];
      if (!M)
        return;
      const { x: B, y: X, width: J, height: I } = C, ae = {}, he = M.origin ?? O, { width: Ee, height: L, x: ce, y: pe } = uM(D, h.controlDirection, Y, h.boundaries, h.keepAspectRatio, he, k, H), Se = Ee !== J, le = L !== I, Te = ce !== B && Se, Ce = pe !== X && le;
      if (!Te && !Ce && !Se && !le)
        return;
      const we = {
        prevValues: { ...C },
        startX: D.x,
        startY: D.y,
        childNodes: Q.map(($e) => ({
          ...$e,
          position: { ...$e.position }
        }))
      };
      if ((Te || Ce || he[0] === 1 || he[1] === 1) && (ae.x = Te ? ce : C.x, ae.y = Ce ? pe : C.y, C.x = ae.x, C.y = ae.y, Q.length > 0)) {
        const $e = ce - B, Me = pe - X;
        for (const Ge of Q)
          Ge.position = {
            x: Ge.position.x - $e + he[0] * (Ee - J),
            y: Ge.position.y - Me + he[1] * (L - I)
          }, j.push(Ge);
      }
      if ((Se || le) && (ae.width = Se && (!h.resizeDirection || h.resizeDirection === "horizontal") ? Ee : C.width, ae.height = le && (!h.resizeDirection || h.resizeDirection === "vertical") ? L : C.height, C.width = ae.width, C.height = ae.height), V && M.expandParent) {
        const $e = he[0] * (ae.width ?? 0);
        ae.x && ae.x < $e && (C.x = $e, D.x = D.x - (ae.x - $e));
        const Me = he[1] * (ae.height ?? 0);
        ae.y && ae.y < Me && (C.y = Me, D.y = D.y - (ae.y - Me));
      }
      const Ne = cM({
        width: C.width,
        prevWidth: J,
        height: C.height,
        prevHeight: I,
        affectsX: h.controlDirection.affectsX,
        affectsY: h.controlDirection.affectsY
      }), ze = { ...C, direction: Ne };
      if (_?.(de, ze) === !1) {
        C = we.prevValues, D.x = we.startX, D.y = we.startY, Q.forEach(($e, Me) => {
          $e.position = we.childNodes[Me].position;
        });
        return;
      }
      E?.(de, ze), r(ae, j);
    }).on("end", (de) => {
      N?.(de, { ...C }), o?.({ ...C });
    });
    f.call(q);
  }
  function v() {
    f.on(".drag", null);
  }
  return {
    update: m,
    destroy: v
  };
}
var Um = { exports: {} }, Bm = {}, $m = { exports: {} }, qm = {};
var n1;
function mM() {
  if (n1) return qm;
  n1 = 1;
  var n = Hc();
  function a(p, S) {
    return p === S && (p !== 0 || 1 / p === 1 / S) || p !== p && S !== S;
  }
  var s = typeof Object.is == "function" ? Object.is : a, r = n.useState, o = n.useEffect, f = n.useLayoutEffect, h = n.useDebugValue;
  function m(p, S) {
    var w = S(), E = r({ inst: { value: w, getSnapshot: S } }), N = E[0].inst, _ = E[1];
    return f(
      function() {
        N.value = w, N.getSnapshot = S, v(N) && _({ inst: N });
      },
      [p, w, S]
    ), o(
      function() {
        return v(N) && _({ inst: N }), p(function() {
          v(N) && _({ inst: N });
        });
      },
      [p]
    ), h(w), w;
  }
  function v(p) {
    var S = p.getSnapshot;
    p = p.value;
    try {
      var w = S();
      return !s(p, w);
    } catch {
      return !0;
    }
  }
  function y(p, S) {
    return S();
  }
  var g = typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u" ? y : m;
  return qm.useSyncExternalStore = n.useSyncExternalStore !== void 0 ? n.useSyncExternalStore : g, qm;
}
var i1;
function pM() {
  return i1 || (i1 = 1, $m.exports = mM()), $m.exports;
}
var a1;
function gM() {
  if (a1) return Bm;
  a1 = 1;
  var n = Hc(), a = pM();
  function s(y, g) {
    return y === g && (y !== 0 || 1 / y === 1 / g) || y !== y && g !== g;
  }
  var r = typeof Object.is == "function" ? Object.is : s, o = a.useSyncExternalStore, f = n.useRef, h = n.useEffect, m = n.useMemo, v = n.useDebugValue;
  return Bm.useSyncExternalStoreWithSelector = function(y, g, p, S, w) {
    var E = f(null);
    if (E.current === null) {
      var N = { hasValue: !1, value: null };
      E.current = N;
    } else N = E.current;
    E = m(
      function() {
        function C(V) {
          if (!D) {
            if (D = !0, M = V, V = S(V), w !== void 0 && N.hasValue) {
              var k = N.value;
              if (w(k, V))
                return R = k;
            }
            return R = V;
          }
          if (k = R, r(M, V)) return k;
          var H = S(V);
          return w !== void 0 && w(k, H) ? (M = V, k) : (M = V, R = H);
        }
        var D = !1, M, R, Q = p === void 0 ? null : p;
        return [
          function() {
            return C(g());
          },
          Q === null ? void 0 : function() {
            return C(Q());
          }
        ];
      },
      [g, p, S, w]
    );
    var _ = o(y, E[0], E[1]);
    return h(
      function() {
        N.hasValue = !0, N.value = _;
      },
      [_]
    ), v(_), _;
  }, Bm;
}
var l1;
function yM() {
  return l1 || (l1 = 1, Um.exports = gM()), Um.exports;
}
var vM = yM();
const xM = /* @__PURE__ */ cb(vM), bM = {}, s1 = (n) => {
  let a;
  const s = /* @__PURE__ */ new Set(), r = (g, p) => {
    const S = typeof g == "function" ? g(a) : g;
    if (!Object.is(S, a)) {
      const w = a;
      a = p ?? (typeof S != "object" || S === null) ? S : Object.assign({}, a, S), s.forEach((E) => E(a, w));
    }
  }, o = () => a, v = { setState: r, getState: o, getInitialState: () => y, subscribe: (g) => (s.add(g), () => s.delete(g)), destroy: () => {
    (bM ? "production" : void 0) !== "production" && console.warn(
      "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
    ), s.clear();
  } }, y = a = n(r, o, v);
  return v;
}, SM = (n) => n ? s1(n) : s1, { useDebugValue: wM } = yc, { useSyncExternalStoreWithSelector: _M } = xM, EM = (n) => n;
function DS(n, a = EM, s) {
  const r = _M(
    n.subscribe,
    n.getState,
    n.getServerState || n.getInitialState,
    a,
    s
  );
  return wM(r), r;
}
const r1 = (n, a) => {
  const s = SM(n), r = (o, f = a) => DS(s, o, f);
  return Object.assign(r, s), r;
}, NM = (n, a) => n ? r1(n, a) : r1;
function Jt(n, a) {
  if (Object.is(n, a))
    return !0;
  if (typeof n != "object" || n === null || typeof a != "object" || a === null)
    return !1;
  if (n instanceof Map && a instanceof Map) {
    if (n.size !== a.size) return !1;
    for (const [r, o] of n)
      if (!Object.is(o, a.get(r)))
        return !1;
    return !0;
  }
  if (n instanceof Set && a instanceof Set) {
    if (n.size !== a.size) return !1;
    for (const r of n)
      if (!a.has(r))
        return !1;
    return !0;
  }
  const s = Object.keys(n);
  if (s.length !== Object.keys(a).length)
    return !1;
  for (const r of s)
    if (!Object.prototype.hasOwnProperty.call(a, r) || !Object.is(n[r], a[r]))
      return !1;
  return !0;
}
ub();
const td = A.createContext(null), TM = td.Provider, HS = Ua.error001("react");
function gt(n, a) {
  const s = A.useContext(td);
  if (s === null)
    throw new Error(HS);
  return DS(s, n, a);
}
function Xt() {
  const n = A.useContext(td);
  if (n === null)
    throw new Error(HS);
  return A.useMemo(() => ({
    getState: n.getState,
    setState: n.setState,
    subscribe: n.subscribe
  }), [n]);
}
const o1 = { display: "none" }, CM = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  border: 0,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0px, 0px, 0px, 0px)",
  clipPath: "inset(100%)"
}, LS = "react-flow__node-desc", US = "react-flow__edge-desc", AM = "react-flow__aria-live", MM = (n) => n.ariaLiveMessage, zM = (n) => n.ariaLabelConfig;
function kM({ rfId: n }) {
  const a = gt(MM);
  return d.jsx("div", { id: `${AM}-${n}`, "aria-live": "assertive", "aria-atomic": "true", style: CM, children: a });
}
function jM({ rfId: n, disableKeyboardA11y: a }) {
  const s = gt(zM);
  return d.jsxs(d.Fragment, { children: [d.jsx("div", { id: `${LS}-${n}`, style: o1, children: a ? s["node.a11yDescription.default"] : s["node.a11yDescription.keyboardDisabled"] }), d.jsx("div", { id: `${US}-${n}`, style: o1, children: s["edge.a11yDescription.default"] }), !a && d.jsx(kM, { rfId: n })] });
}
const nd = A.forwardRef(({ position: n = "top-left", children: a, className: s, style: r, ...o }, f) => {
  const h = `${n}`.split("-");
  return d.jsx("div", { className: An(["react-flow__panel", s, ...h]), style: r, ref: f, ...o, children: a });
});
nd.displayName = "Panel";
const c1 = "https://reactflow.dev?utm_source=attribution";
function RM({ proOptions: n, position: a = "bottom-right" }) {
  return A.useEffect(() => {
  }, []), n?.hideAttribution ? null : d.jsx(nd, { position: a, className: "react-flow__attribution", "data-message": `Please only hide this attribution when you are subscribed to React Flow Pro: ${c1}`, children: d.jsx("a", { href: c1, target: "_blank", rel: "noopener noreferrer", "aria-label": "React Flow attribution", children: "React Flow" }) });
}
const OM = (n) => {
  const a = [], s = [];
  for (const [, r] of n.nodeLookup)
    r.selected && a.push(r.internals.userNode);
  for (const [, r] of n.edgeLookup)
    r.selected && s.push(r);
  return { selectedNodes: a, selectedEdges: s };
}, hf = (n) => n.id;
function DM(n, a) {
  return Jt(n.selectedNodes.map(hf), a.selectedNodes.map(hf)) && Jt(n.selectedEdges.map(hf), a.selectedEdges.map(hf));
}
function HM({ onSelectionChange: n }) {
  const a = Xt(), { selectedNodes: s, selectedEdges: r } = gt(OM, DM);
  return A.useEffect(() => {
    const o = { nodes: s, edges: r };
    n?.(o), a.getState().onSelectionChangeHandlers.forEach((f) => f(o));
  }, [s, r, n]), null;
}
const LM = (n) => !!n.onSelectionChangeHandlers;
function UM({ onSelectionChange: n }) {
  const a = gt(LM);
  return n || a ? d.jsx(HM, { onSelectionChange: n }) : null;
}
const BS = [0, 0], BM = { x: 0, y: 0, zoom: 1 }, $M = [
  "nodes",
  "edges",
  "defaultNodes",
  "defaultEdges",
  "onConnect",
  "onConnectStart",
  "onConnectEnd",
  "onClickConnectStart",
  "onClickConnectEnd",
  "nodesDraggable",
  "autoPanOnNodeFocus",
  "nodesConnectable",
  "nodesFocusable",
  "edgesFocusable",
  "edgesReconnectable",
  "elevateNodesOnSelect",
  "elevateEdgesOnSelect",
  "minZoom",
  "maxZoom",
  "nodeExtent",
  "onNodesChange",
  "onEdgesChange",
  "elementsSelectable",
  "connectionMode",
  "snapGrid",
  "snapToGrid",
  "translateExtent",
  "connectOnClick",
  "defaultEdgeOptions",
  "fitView",
  "fitViewOptions",
  "onNodesDelete",
  "onEdgesDelete",
  "onDelete",
  "onNodeDrag",
  "onNodeDragStart",
  "onNodeDragStop",
  "onSelectionDrag",
  "onSelectionDragStart",
  "onSelectionDragStop",
  "onMoveStart",
  "onMove",
  "onMoveEnd",
  "noPanClassName",
  "nodeOrigin",
  "autoPanOnConnect",
  "autoPanOnNodeDrag",
  "onError",
  "connectionRadius",
  "isValidConnection",
  "selectNodesOnDrag",
  "nodeDragThreshold",
  "connectionDragThreshold",
  "onBeforeDelete",
  "debug",
  "autoPanSpeed",
  "ariaLabelConfig",
  "zIndexMode"
], u1 = [...$M, "rfId"], qM = (n) => ({
  setNodes: n.setNodes,
  setEdges: n.setEdges,
  setMinZoom: n.setMinZoom,
  setMaxZoom: n.setMaxZoom,
  setTranslateExtent: n.setTranslateExtent,
  setNodeExtent: n.setNodeExtent,
  reset: n.reset,
  setDefaultNodesAndEdges: n.setDefaultNodesAndEdges
}), f1 = {
  /*
   * these are values that are also passed directly to other components
   * than the StoreUpdater. We can reduce the number of setStore calls
   * by setting the same values here as prev fields.
   */
  translateExtent: jc,
  nodeOrigin: BS,
  minZoom: 0.5,
  maxZoom: 2,
  elementsSelectable: !0,
  noPanClassName: "nopan",
  rfId: "1"
};
function VM(n) {
  const { setNodes: a, setEdges: s, setMinZoom: r, setMaxZoom: o, setTranslateExtent: f, setNodeExtent: h, reset: m, setDefaultNodesAndEdges: v } = gt(qM, Jt), y = Xt();
  A.useEffect(() => (v(n.defaultNodes, n.defaultEdges), () => {
    g.current = f1, m();
  }), []);
  const g = A.useRef(f1);
  return A.useEffect(
    () => {
      for (const p of u1) {
        const S = n[p], w = g.current[p];
        S !== w && (typeof n[p] > "u" || (p === "nodes" ? a(S) : p === "edges" ? s(S) : p === "minZoom" ? r(S) : p === "maxZoom" ? o(S) : p === "translateExtent" ? f(S) : p === "nodeExtent" ? h(S) : p === "ariaLabelConfig" ? y.setState({ ariaLabelConfig: _A(S) }) : p === "fitView" ? y.setState({ fitViewQueued: S }) : p === "fitViewOptions" ? y.setState({ fitViewOptions: S }) : y.setState({ [p]: S })));
      }
      g.current = n;
    },
    // Only re-run the effect if one of the fields we track changes
    u1.map((p) => n[p])
  ), null;
}
function d1() {
  return typeof window > "u" || !window.matchMedia ? null : window.matchMedia("(prefers-color-scheme: dark)");
}
function YM(n) {
  const [a, s] = A.useState(n === "system" ? null : n);
  return A.useEffect(() => {
    if (n !== "system") {
      s(n);
      return;
    }
    const r = d1(), o = () => s(r?.matches ? "dark" : "light");
    return o(), r?.addEventListener("change", o), () => {
      r?.removeEventListener("change", o);
    };
  }, [n]), a !== null ? a : d1()?.matches ? "dark" : "light";
}
const h1 = typeof document < "u" ? document : null;
function Dc(n = null, a = { target: h1, actInsideInputWithModifier: !0 }) {
  const [s, r] = A.useState(!1), o = A.useRef(!1), f = A.useRef(/* @__PURE__ */ new Set([])), [h, m] = A.useMemo(() => {
    if (n !== null) {
      const y = (Array.isArray(n) ? n : [n]).filter((p) => typeof p == "string").map((p) => p.replace(/\+/g, `
`).replace(`

`, `
+`).split(`
`)), g = y.reduce((p, S) => p.concat(...S), []);
      return [y, g];
    }
    return [[], []];
  }, [n]);
  return A.useEffect(() => {
    const v = a?.target ?? h1, y = a?.actInsideInputWithModifier ?? !0;
    if (n !== null) {
      const g = (w) => {
        if (o.current = w.ctrlKey || w.metaKey || w.shiftKey || w.altKey, (!o.current || o.current && !y) && vS(w))
          return !1;
        const N = p1(w.code, m);
        if (f.current.add(w[N]), m1(h, f.current, !1)) {
          const _ = w.composedPath?.()?.[0] || w.target, C = _?.nodeName === "BUTTON" || _?.nodeName === "A";
          a.preventDefault !== !1 && (o.current || !C) && w.preventDefault(), r(!0);
        }
      }, p = (w) => {
        const E = p1(w.code, m);
        m1(h, f.current, !0) ? (r(!1), f.current.clear()) : f.current.delete(w[E]), w.key === "Meta" && f.current.clear(), o.current = !1;
      }, S = () => {
        f.current.clear(), r(!1);
      };
      return v?.addEventListener("keydown", g), v?.addEventListener("keyup", p), window.addEventListener("blur", S), window.addEventListener("contextmenu", S), () => {
        v?.removeEventListener("keydown", g), v?.removeEventListener("keyup", p), window.removeEventListener("blur", S), window.removeEventListener("contextmenu", S);
      };
    }
  }, [n, r]), s;
}
function m1(n, a, s) {
  return n.filter((r) => s || r.length === a.size).some((r) => r.every((o) => a.has(o)));
}
function p1(n, a) {
  return a.includes(n) ? "code" : "key";
}
const IM = () => {
  const n = Xt();
  return A.useMemo(() => ({
    zoomIn: async (a) => {
      const { panZoom: s } = n.getState();
      return s ? s.scaleBy(1.2, a) : !1;
    },
    zoomOut: async (a) => {
      const { panZoom: s } = n.getState();
      return s ? s.scaleBy(1 / 1.2, a) : !1;
    },
    zoomTo: async (a, s) => {
      const { panZoom: r } = n.getState();
      return r ? r.scaleTo(a, s) : !1;
    },
    getZoom: () => n.getState().transform[2],
    setViewport: async (a, s) => {
      const { transform: [r, o, f], panZoom: h } = n.getState();
      return h ? (await h.setViewport({
        x: a.x ?? r,
        y: a.y ?? o,
        zoom: a.zoom ?? f
      }, s), !0) : !1;
    },
    getViewport: () => {
      const [a, s, r] = n.getState().transform;
      return { x: a, y: s, zoom: r };
    },
    setCenter: async (a, s, r) => n.getState().setCenter(a, s, r),
    fitBounds: async (a, s) => {
      const { width: r, height: o, minZoom: f, maxZoom: h, panZoom: m } = n.getState(), v = Xp(a, r, o, f, h, s?.padding ?? 0.1);
      return m ? (await m.setViewport(v, {
        duration: s?.duration,
        ease: s?.ease,
        interpolate: s?.interpolate
      }), !0) : !1;
    },
    screenToFlowPosition: (a, s = {}) => {
      const { transform: r, snapGrid: o, snapToGrid: f, domNode: h } = n.getState();
      if (!h)
        return a;
      const { x: m, y: v } = h.getBoundingClientRect(), y = {
        x: a.x - m,
        y: a.y - v
      }, g = s.snapGrid ?? o, p = s.snapToGrid ?? f;
      return Vc(y, r, p, g);
    },
    flowToScreenPosition: (a) => {
      const { transform: s, domNode: r } = n.getState();
      if (!r)
        return a;
      const { x: o, y: f } = r.getBoundingClientRect(), h = mo(a, s);
      return {
        x: h.x + o,
        y: h.y + f
      };
    }
  }), []);
};
function $S(n, a) {
  const s = [], r = /* @__PURE__ */ new Map(), o = [];
  for (const f of n)
    if (f.type === "add") {
      o.push(f);
      continue;
    } else if (f.type === "remove" || f.type === "replace")
      r.set(f.id, [f]);
    else {
      const h = r.get(f.id);
      h ? h.push(f) : r.set(f.id, [f]);
    }
  for (const f of a) {
    const h = r.get(f.id);
    if (!h) {
      s.push(f);
      continue;
    }
    if (h[0].type === "remove")
      continue;
    if (h[0].type === "replace") {
      s.push({ ...h[0].item });
      continue;
    }
    const m = { ...f };
    for (const v of h)
      XM(v, m);
    s.push(m);
  }
  return o.length && o.forEach((f) => {
    f.index !== void 0 ? s.splice(f.index, 0, { ...f.item }) : s.push({ ...f.item });
  }), s;
}
function XM(n, a) {
  switch (n.type) {
    case "select": {
      a.selected = n.selected;
      break;
    }
    case "position": {
      typeof n.position < "u" && (a.position = n.position), typeof n.dragging < "u" && (a.dragging = n.dragging);
      break;
    }
    case "dimensions": {
      typeof n.dimensions < "u" && (a.measured = {
        ...n.dimensions
      }, n.setAttributes && ((n.setAttributes === !0 || n.setAttributes === "width") && (a.width = n.dimensions.width), (n.setAttributes === !0 || n.setAttributes === "height") && (a.height = n.dimensions.height))), typeof n.resizing == "boolean" && (a.resizing = n.resizing);
      break;
    }
  }
}
function GM(n, a) {
  return $S(n, a);
}
function ZM(n, a) {
  return $S(n, a);
}
function Ys(n, a) {
  return {
    id: n,
    type: "select",
    selected: a
  };
}
function Fr(n, a = /* @__PURE__ */ new Set()) {
  const s = [];
  for (const [r, o] of n) {
    const f = a.has(r);
    !(o.selected === void 0 && !f) && o.selected !== f && s.push(Ys(o.id, f));
  }
  return s;
}
function g1({ items: n = [], lookup: a }) {
  const s = [], r = new Map(n.map((o) => [o.id, o]));
  for (const [o, f] of n.entries()) {
    const h = a.get(f.id), m = h?.internals?.userNode ?? h;
    m !== void 0 && m !== f && s.push({ id: f.id, item: f, type: "replace" }), m === void 0 && s.push({ item: f, type: "add", index: o });
  }
  for (const [o] of a)
    r.get(o) === void 0 && s.push({ id: o, type: "remove" });
  return s;
}
function y1(n) {
  return {
    id: n.id,
    type: "remove"
  };
}
const QM = hS();
function KM(n, a, s = {}) {
  return MA(n, a, {
    ...s,
    onError: s.onError ?? QM
  });
}
const v1 = (n) => mA(n), PM = (n) => oS(n);
function qS(n) {
  return A.forwardRef(n);
}
const VS = typeof window < "u" ? A.useLayoutEffect : A.useEffect;
function x1(n) {
  const [a, s] = A.useState(BigInt(0)), [r] = A.useState(() => JM(() => s((o) => o + BigInt(1))));
  return VS(() => {
    const o = r.get();
    o.length && (n(o), r.reset());
  }, [a]), r;
}
function JM(n) {
  let a = [];
  return {
    get: () => a,
    reset: () => {
      a = [];
    },
    push: (s) => {
      a.push(s), n();
    }
  };
}
const YS = A.createContext(null);
function FM({ children: n }) {
  const a = Xt(), s = A.useCallback((m) => {
    const { nodes: v = [], setNodes: y, hasDefaultNodes: g, onNodesChange: p, nodeLookup: S, fitViewQueued: w, onNodesChangeMiddlewareMap: E } = a.getState();
    let N = v;
    for (const C of m)
      N = typeof C == "function" ? C(N) : C;
    let _ = g1({
      items: N,
      lookup: S
    });
    for (const C of E.values())
      _ = C(_);
    g && y(N), _.length > 0 ? p?.(_) : w && window.requestAnimationFrame(() => {
      const { fitViewQueued: C, nodes: D, setNodes: M } = a.getState();
      C && M(D);
    });
  }, []), r = x1(s), o = A.useCallback((m) => {
    const { edges: v = [], setEdges: y, hasDefaultEdges: g, onEdgesChange: p, edgeLookup: S } = a.getState();
    let w = v;
    for (const E of m)
      w = typeof E == "function" ? E(w) : E;
    g ? y(w) : p && p(g1({
      items: w,
      lookup: S
    }));
  }, []), f = x1(o), h = A.useMemo(() => ({ nodeQueue: r, edgeQueue: f }), []);
  return d.jsx(YS.Provider, { value: h, children: n });
}
function WM() {
  const n = A.useContext(YS);
  if (!n)
    throw new Error("useBatchContext must be used within a BatchProvider");
  return n;
}
const ez = (n) => !!n.panZoom;
function id() {
  const n = IM(), a = Xt(), s = WM(), r = gt(ez), o = A.useMemo(() => {
    const f = (p) => a.getState().nodeLookup.get(p), h = (p) => {
      s.nodeQueue.push(p);
    }, m = (p) => {
      s.edgeQueue.push(p);
    }, v = (p) => {
      const { nodeLookup: S, nodeOrigin: w } = a.getState(), E = v1(p) ? p : S.get(p.id), N = E.parentId ? pS(E.position, E.measured, E.parentId, S, w) : E.position, _ = {
        ...E,
        position: N,
        width: E.measured?.width ?? E.width,
        height: E.measured?.height ?? E.height
      };
      return Rc(_, E.parentId ? void 0 : w);
    }, y = (p, S, w = { replace: !1 }) => {
      h((E) => E.map((N) => {
        if (N.id === p) {
          const _ = typeof S == "function" ? S(N) : S;
          return w.replace && v1(_) ? _ : { ...N, ..._ };
        }
        return N;
      }));
    }, g = (p, S, w = { replace: !1 }) => {
      m((E) => E.map((N) => {
        if (N.id === p) {
          const _ = typeof S == "function" ? S(N) : S;
          return w.replace && PM(_) ? _ : { ...N, ..._ };
        }
        return N;
      }));
    };
    return {
      getNodes: () => a.getState().nodes.map((p) => ({ ...p })),
      getNode: (p) => f(p)?.internals.userNode,
      getInternalNode: f,
      getEdges: () => {
        const { edges: p = [] } = a.getState();
        return p.map((S) => ({ ...S }));
      },
      getEdge: (p) => a.getState().edgeLookup.get(p),
      setNodes: h,
      setEdges: m,
      addNodes: (p) => {
        const S = Array.isArray(p) ? p : [p];
        s.nodeQueue.push((w) => [...w, ...S]);
      },
      addEdges: (p) => {
        const S = Array.isArray(p) ? p : [p];
        s.edgeQueue.push((w) => [...w, ...S]);
      },
      toObject: () => {
        const { nodes: p = [], edges: S = [], transform: w } = a.getState(), [E, N, _] = w;
        return {
          nodes: p.map((C) => ({ ...C })),
          edges: S.map((C) => ({ ...C })),
          viewport: {
            x: E,
            y: N,
            zoom: _
          }
        };
      },
      deleteElements: async ({ nodes: p = [], edges: S = [] }) => {
        const { nodes: w, edges: E, onNodesDelete: N, onEdgesDelete: _, triggerNodeChanges: C, triggerEdgeChanges: D, onDelete: M, onBeforeDelete: R } = a.getState(), { nodes: Q, edges: V } = await xA({
          nodesToRemove: p,
          edgesToRemove: S,
          nodes: w,
          edges: E,
          onBeforeDelete: R
        }), k = V.length > 0, H = Q.length > 0;
        if (k) {
          const q = V.map(y1);
          _?.(V), D(q);
        }
        if (H) {
          const q = Q.map(y1);
          N?.(Q), C(q);
        }
        return (H || k) && M?.({ nodes: Q, edges: V }), { deletedNodes: Q, deletedEdges: V };
      },
      /**
       * Partial is defined as "the 2 nodes/areas are intersecting partially".
       * If a is contained in b or b is contained in a, they are both
       * considered fully intersecting.
       */
      getIntersectingNodes: (p, S = !0, w) => {
        const E = Yx(p), N = E ? p : v(p), _ = w !== void 0;
        if (!N)
          return [];
        const { nodeOrigin: C } = a.getState();
        return (w || a.getState().nodes).filter((D) => {
          const M = a.getState().nodeLookup.get(D.id);
          if (M && !E && (D.id === p.id || !M.internals.positionAbsolute))
            return !1;
          const R = Rc(_ ? D : M, C), Q = Bf(R, N);
          return S && Q > 0 || Q >= R.width * R.height || Q >= N.width * N.height;
        });
      },
      isNodeIntersecting: (p, S, w = !0) => {
        const N = Yx(p) ? p : v(p);
        if (!N)
          return !1;
        const _ = Bf(N, S);
        return w && _ > 0 || _ >= S.width * S.height || _ >= N.width * N.height;
      },
      updateNode: y,
      updateNodeData: (p, S, w = { replace: !1 }) => {
        y(p, (E) => {
          const N = typeof S == "function" ? S(E) : S;
          return w.replace ? { ...E, data: N } : { ...E, data: { ...E.data, ...N } };
        }, w);
      },
      updateEdge: g,
      updateEdgeData: (p, S, w = { replace: !1 }) => {
        g(p, (E) => {
          const N = typeof S == "function" ? S(E) : S;
          return w.replace ? { ...E, data: N } : { ...E, data: { ...E.data, ...N } };
        }, w);
      },
      getNodesBounds: (p) => {
        const { nodeLookup: S, nodeOrigin: w } = a.getState();
        return pA(p, { nodeLookup: S, nodeOrigin: w });
      },
      getHandleConnections: ({ type: p, id: S, nodeId: w }) => Array.from(a.getState().connectionLookup.get(`${w}-${p}${S ? `-${S}` : ""}`)?.values() ?? []),
      getNodeConnections: ({ type: p, handleId: S, nodeId: w }) => Array.from(a.getState().connectionLookup.get(`${w}${p ? S ? `-${p}-${S}` : `-${p}` : ""}`)?.values() ?? []),
      fitView: async (p) => {
        const S = a.getState().fitViewResolver ?? wA();
        return a.setState({ fitViewQueued: !0, fitViewOptions: p, fitViewResolver: S }), s.nodeQueue.push((w) => [...w]), S.promise;
      }
    };
  }, []);
  return A.useMemo(() => ({
    ...o,
    ...n,
    viewportInitialized: r
  }), [r]);
}
const b1 = (n) => n.selected, tz = typeof window < "u" ? window : void 0;
function nz({ deleteKeyCode: n, multiSelectionKeyCode: a }) {
  const s = Xt(), { deleteElements: r } = id(), o = Dc(n, { actInsideInputWithModifier: !1 }), f = Dc(a, { target: tz });
  A.useEffect(() => {
    if (o) {
      const { edges: h, nodes: m } = s.getState();
      r({ nodes: m.filter(b1), edges: h.filter(b1) }), s.setState({ nodesSelectionActive: !1 });
    }
  }, [o]), A.useEffect(() => {
    s.setState({ multiSelectionActive: f });
  }, [f]);
}
function iz(n) {
  const a = Xt();
  A.useEffect(() => {
    const s = () => {
      if (!n.current || !(n.current.checkVisibility?.() ?? !0))
        return !1;
      const r = Gp(n.current);
      (r.height === 0 || r.width === 0) && a.getState().onError?.("004", Ua.error004()), a.setState({ width: r.width || 500, height: r.height || 500 });
    };
    if (n.current) {
      s(), window.addEventListener("resize", s);
      const r = new ResizeObserver(() => s());
      return r.observe(n.current), () => {
        window.removeEventListener("resize", s), r.disconnect();
      };
    }
  }, []);
}
const ad = {
  position: "absolute",
  width: "100%",
  height: "100%",
  top: 0,
  left: 0
}, az = (n) => ({
  userSelectionActive: n.userSelectionActive,
  lib: n.lib,
  connectionInProgress: n.connection.inProgress
});
function lz({ onPaneContextMenu: n, zoomOnScroll: a = !0, zoomOnPinch: s = !0, panOnScroll: r = !1, panActivationKeyPressed: o, panOnScrollSpeed: f = 0.5, panOnScrollMode: h = Js.Free, zoomOnDoubleClick: m = !0, panOnDrag: v = !0, defaultViewport: y, translateExtent: g, minZoom: p, maxZoom: S, zoomActivationKeyCode: w, preventScrolling: E = !0, children: N, noWheelClassName: _, noPanClassName: C, onViewportChange: D, isControlledViewport: M, paneClickDistance: R, selectionOnDrag: Q }) {
  const V = Xt(), k = A.useRef(null), { userSelectionActive: H, lib: q, connectionInProgress: de } = gt(az, Jt), ee = Dc(w), me = A.useRef();
  iz(k);
  const te = A.useCallback((O) => {
    D?.({ x: O[0], y: O[1], zoom: O[2] }), M || V.setState({ transform: O });
  }, [D, M]);
  return A.useEffect(() => {
    if (k.current) {
      me.current = sM({
        domNode: k.current,
        minZoom: p,
        maxZoom: S,
        translateExtent: g,
        viewport: y,
        onDraggingChange: (B) => V.setState((X) => X.paneDragging === B ? X : { paneDragging: B }),
        onPanZoomStart: (B, X) => {
          const { onViewportChangeStart: J, onMoveStart: I } = V.getState();
          I?.(B, X), J?.(X);
        },
        onPanZoom: (B, X) => {
          const { onViewportChange: J, onMove: I } = V.getState();
          I?.(B, X), J?.(X);
        },
        onPanZoomEnd: (B, X) => {
          const { onViewportChangeEnd: J, onMoveEnd: I } = V.getState();
          I?.(B, X), J?.(X);
        }
      });
      const { x: O, y: Y, zoom: j } = me.current.getViewport();
      return V.setState({
        panZoom: me.current,
        transform: [O, Y, j],
        domNode: k.current.closest(".react-flow")
      }), () => {
        me.current?.destroy();
      };
    }
  }, []), A.useEffect(() => {
    me.current?.update({
      onPaneContextMenu: n,
      zoomOnScroll: a,
      zoomOnPinch: s,
      panOnScroll: r,
      panActivationKeyPressed: o,
      panOnScrollSpeed: f,
      panOnScrollMode: h,
      zoomOnDoubleClick: m,
      panOnDrag: v,
      zoomActivationKeyPressed: ee,
      preventScrolling: E,
      noPanClassName: C,
      userSelectionActive: H,
      noWheelClassName: _,
      lib: q,
      onTransformChange: te,
      connectionInProgress: de,
      selectionOnDrag: Q,
      paneClickDistance: R
    });
  }, [
    n,
    a,
    s,
    r,
    o,
    f,
    h,
    m,
    v,
    ee,
    E,
    C,
    H,
    _,
    q,
    te,
    de,
    Q,
    R
  ]), d.jsx("div", { className: "react-flow__renderer", ref: k, style: ad, children: N });
}
const sz = (n) => ({
  userSelectionActive: n.userSelectionActive,
  userSelectionRect: n.userSelectionRect
});
function rz() {
  const { userSelectionActive: n, userSelectionRect: a } = gt(sz, Jt);
  return n && a ? d.jsx("div", { className: "react-flow__selection react-flow__container", style: {
    width: a.width,
    height: a.height,
    transform: `translate(${a.x}px, ${a.y}px)`
  } }) : null;
}
const Vm = (n, a) => (s) => {
  s.target === a.current && n?.(s);
}, oz = (n) => ({
  userSelectionActive: n.userSelectionActive,
  elementsSelectable: n.elementsSelectable,
  dragging: n.paneDragging,
  panBy: n.panBy,
  autoPanSpeed: n.autoPanSpeed
});
function cz({ isSelecting: n, selectionKeyPressed: a, selectionMode: s = fo.Full, panOnDrag: r, autoPanOnSelection: o, paneClickDistance: f, selectionOnDrag: h, onSelectionStart: m, onSelectionEnd: v, onPaneClick: y, onPaneContextMenu: g, onPaneScroll: p, onPaneMouseEnter: S, onPaneMouseMove: w, onPaneMouseLeave: E, children: N }) {
  const _ = A.useRef(0), C = Xt(), { userSelectionActive: D, elementsSelectable: M, dragging: R, panBy: Q, autoPanSpeed: V } = gt(oz, Jt), k = M && (n || D), H = A.useRef(null), q = A.useRef(), de = A.useRef(/* @__PURE__ */ new Set()), ee = A.useRef(/* @__PURE__ */ new Set()), me = A.useRef(!1), te = A.useRef(!1), O = A.useRef({ x: 0, y: 0 }), Y = A.useRef(!1), j = (le) => {
    if (te.current || me.current || C.getState().connection.inProgress) {
      te.current = !1, me.current = !1;
      return;
    }
    const { connectionClickStartHandle: Te, connection: Ce, onClickConnectEnd: we, resetSelectedElements: Ne } = C.getState();
    if (Te) {
      const ze = structuredClone(Ce);
      delete ze.inProgress, ze.toPosition = ze.toHandle ? ze.toHandle.position : null, we?.(le.nativeEvent, ze), C.setState({ connectionClickStartHandle: null });
    }
    y?.(le), Ne(), C.setState({ nodesSelectionActive: !1 });
  }, B = (le) => {
    if (Array.isArray(r) && r?.includes(2)) {
      le.preventDefault();
      return;
    }
    g?.(le);
  }, X = p ? (le) => p(le) : void 0, J = (le) => {
    te.current && (le.stopPropagation(), te.current = !1);
  }, I = (le) => {
    if (le.pointerType === "touch" && r !== !1 && !a)
      return;
    const { domNode: Te, transform: Ce } = C.getState();
    if (q.current = Te?.getBoundingClientRect(), !q.current)
      return;
    const we = le.target === H.current;
    if (!we && !!le.target.closest(".nokey") || !n || !(h && we || a) || le.button !== 0 || !le.isPrimary)
      return;
    le.target?.setPointerCapture?.(le.pointerId), te.current = !1;
    const { x: Ve, y: $e } = Ha(le.nativeEvent, q.current), Me = Vc({ x: Ve, y: $e }, Ce);
    C.setState({
      userSelectionRect: {
        width: 0,
        height: 0,
        startX: Me.x,
        startY: Me.y,
        x: Ve,
        y: $e
      }
    }), we || (le.stopPropagation(), le.preventDefault());
  };
  function ae(le, Te) {
    const { userSelectionRect: Ce } = C.getState();
    if (!Ce)
      return;
    const { transform: we, nodeLookup: Ne, edgeLookup: ze, connectionLookup: Ve, triggerNodeChanges: $e, triggerEdgeChanges: Me, defaultEdgeOptions: Ge } = C.getState(), Re = { x: Ce.startX, y: Ce.startY }, { x: _t, y: it } = mo(Re, we), At = {
      startX: Re.x,
      startY: Re.y,
      x: le < _t ? le : _t,
      y: Te < it ? Te : it,
      width: Math.abs(le - _t),
      height: Math.abs(Te - it)
    }, Mn = de.current, Et = ee.current;
    de.current = new Set(Yp(Ne, At, we, s === fo.Partial, !0).map((It) => It.id)), ee.current = /* @__PURE__ */ new Set();
    const sn = Ge?.selectable ?? !0;
    for (const It of de.current) {
      const bt = Ve.get(It);
      if (bt)
        for (const { edgeId: Nt } of bt.values()) {
          const St = ze.get(Nt);
          St && (St.selectable ?? sn) && ee.current.add(Nt);
        }
    }
    if (!Ix(Mn, de.current)) {
      const It = Fr(Ne, de.current);
      $e(It);
    }
    if (!Ix(Et, ee.current)) {
      const It = Fr(ze, ee.current);
      Me(It);
    }
    C.setState({
      userSelectionRect: At,
      userSelectionActive: !0,
      nodesSelectionActive: !1
    });
  }
  function he() {
    if (!o || !q.current)
      return;
    const [le, Te] = Ip(O.current, q.current, V);
    Q({ x: le, y: Te }).then((Ce) => {
      if (!te.current || !Ce) {
        _.current = requestAnimationFrame(he);
        return;
      }
      const { x: we, y: Ne } = O.current;
      ae(we, Ne), _.current = requestAnimationFrame(he);
    });
  }
  const Ee = () => {
    cancelAnimationFrame(_.current), _.current = 0, Y.current = !1;
  };
  A.useEffect(() => () => Ee(), []);
  const L = (le) => {
    const { userSelectionRect: Te, transform: Ce, resetSelectedElements: we } = C.getState();
    if (!q.current || !Te)
      return;
    const { x: Ne, y: ze } = Ha(le.nativeEvent, q.current);
    O.current = { x: Ne, y: ze };
    const Ve = mo({ x: Te.startX, y: Te.startY }, Ce);
    if (!te.current) {
      const $e = a ? 0 : f;
      if (Math.hypot(Ne - Ve.x, ze - Ve.y) <= $e)
        return;
      we(), m?.(le);
    }
    te.current = !0, Y.current || (he(), Y.current = !0), ae(Ne, ze);
  }, ce = (le) => {
    if (!k) {
      le.target === H.current && C.getState().connection.inProgress && (me.current = !0);
      return;
    }
    le.button === 0 && (le.target?.releasePointerCapture?.(le.pointerId), !D && le.target === H.current && C.getState().userSelectionRect && j?.(le), C.setState({
      userSelectionActive: !1,
      userSelectionRect: null
    }), te.current && (v?.(le), C.setState({
      nodesSelectionActive: de.current.size > 0
    })), Ee());
  }, pe = (le) => {
    le.target?.releasePointerCapture?.(le.pointerId), Ee();
  }, Se = r === !0 || Array.isArray(r) && r.includes(0);
  return d.jsxs("div", { className: An(["react-flow__pane", { draggable: Se, dragging: R, selection: n }]), onClick: k ? void 0 : Vm(j, H), onContextMenu: Vm(B, H), onWheel: Vm(X, H), onPointerEnter: k ? void 0 : S, onPointerMove: k ? L : w, onPointerUp: ce, onPointerCancel: k ? pe : void 0, onPointerDownCapture: k ? I : void 0, onClickCapture: k ? J : void 0, onPointerLeave: E, ref: H, style: ad, children: [N, d.jsx(rz, {})] });
}
function Sp({ id: n, store: a, unselect: s = !1, nodeRef: r }) {
  const { addSelectedNodes: o, unselectNodesAndEdges: f, multiSelectionActive: h, nodeLookup: m, onError: v } = a.getState(), y = m.get(n);
  if (!y) {
    v?.("012", Ua.error012(n));
    return;
  }
  a.setState({ nodesSelectionActive: !1 }), y.selected ? (s || y.selected && h) && (f({ nodes: [y], edges: [] }), requestAnimationFrame(() => r?.current?.blur())) : o([n]);
}
function IS({ nodeRef: n, disabled: a = !1, noDragClassName: s, handleSelector: r, nodeId: o, isSelectable: f, nodeClickDistance: h }) {
  const m = Xt(), [v, y] = A.useState(!1), g = A.useRef();
  return A.useEffect(() => {
    if (!a)
      return g.current = GA({
        getStoreItems: () => m.getState(),
        onNodeMouseDown: (p) => {
          Sp({
            id: p,
            store: m,
            nodeRef: n
          });
        },
        onDragStart: () => {
          y(!0);
        },
        onDragStop: () => {
          y(!1);
        }
      }), () => {
        g.current?.destroy(), g.current = void 0;
      };
  }, [a, m, n]), A.useEffect(() => {
    a || !n.current || !g.current || g.current.update({
      noDragClassName: s,
      handleSelector: r,
      domNode: n.current,
      isSelectable: f,
      nodeId: o,
      nodeClickDistance: h
    });
  }, [s, r, a, f, n, o, h]), v;
}
const uz = (n) => (a) => a.selected && (a.draggable || n && typeof a.draggable > "u");
function XS() {
  const n = Xt();
  return A.useCallback((s) => {
    const { nodeExtent: r, snapToGrid: o, snapGrid: f, nodesDraggable: h, onError: m, updateNodePositions: v, nodeLookup: y, nodeOrigin: g } = n.getState(), p = /* @__PURE__ */ new Map(), S = uz(h), w = o ? f[0] : 5, E = o ? f[1] : 5, N = s.direction.x * w * s.factor, _ = s.direction.y * E * s.factor;
    for (const [, C] of y) {
      if (!S(C))
        continue;
      let D = {
        x: C.internals.positionAbsolute.x + N,
        y: C.internals.positionAbsolute.y + _
      };
      o && (D = qc(D, f));
      const { position: M, positionAbsolute: R } = cS({
        nodeId: C.id,
        nextPosition: D,
        nodeLookup: y,
        nodeExtent: r,
        nodeOrigin: g,
        onError: m
      });
      C.position = M, C.internals.positionAbsolute = R, p.set(C.id, C);
    }
    v(p);
  }, []);
}
const Fp = A.createContext(null), fz = Fp.Provider;
Fp.Consumer;
const GS = () => A.useContext(Fp), dz = (n) => ({
  connectOnClick: n.connectOnClick,
  noPanClassName: n.noPanClassName,
  rfId: n.rfId
}), ZS = A.createContext(null);
function hz({ children: n }) {
  const a = gt(dz, Jt);
  return d.jsx(ZS.Provider, { value: a, children: n });
}
function mz() {
  const n = A.useContext(ZS);
  if (!n)
    throw new Error("useHandleConfig must be used within a HandleConfigProvider");
  return n;
}
const pz = {
  connectingFrom: !1,
  connectingTo: !1,
  clickConnecting: !1,
  isPossibleEndHandle: !0,
  connectionInProcess: !1,
  clickConnectionInProcess: !1,
  valid: !1
}, gz = (n, a, s) => (r) => {
  const { connectionClickStartHandle: o, connectionMode: f, connection: h } = r, { fromHandle: m, toHandle: v, isValid: y } = h;
  if (!m && !o)
    return pz;
  const g = v?.nodeId === n && v?.id === a && v?.type === s;
  return {
    connectingFrom: m?.nodeId === n && m?.id === a && m?.type === s,
    connectingTo: g,
    clickConnecting: o?.nodeId === n && o?.id === a && o?.type === s,
    isPossibleEndHandle: f === uo.Strict ? m?.type !== s : n !== m?.nodeId || a !== m?.id,
    connectionInProcess: !!m,
    clickConnectionInProcess: !!o,
    valid: g && y
  };
};
function yz({ type: n = "source", position: a = Ue.Top, isValidConnection: s, isConnectable: r = !0, isConnectableStart: o = !0, isConnectableEnd: f = !0, id: h, onConnect: m, children: v, className: y, onMouseDown: g, onTouchStart: p, ...S }, w) {
  const E = h || null, N = n === "target", _ = Xt(), C = GS(), { connectOnClick: D, noPanClassName: M, rfId: R } = mz(), { connectingFrom: Q, connectingTo: V, clickConnecting: k, isPossibleEndHandle: H, connectionInProcess: q, clickConnectionInProcess: de, valid: ee } = gt(gz(C, E, n), Jt);
  C || _.getState().onError?.("010", Ua.error010());
  const me = (Y) => {
    const { defaultEdgeOptions: j, onConnect: B, hasDefaultEdges: X } = _.getState(), J = {
      ...j,
      ...Y
    };
    if (X) {
      const { edges: I, setEdges: ae, onError: he } = _.getState();
      ae(KM(J, I, { onError: he }));
    }
    B?.(J), m?.(J);
  }, te = (Y) => {
    if (!C)
      return;
    const j = xS(Y.nativeEvent);
    if (o && (j && Y.button === 0 || !j)) {
      const B = _.getState();
      bp.onPointerDown(Y.nativeEvent, {
        handleDomNode: Y.currentTarget,
        autoPanOnConnect: B.autoPanOnConnect,
        connectionMode: B.connectionMode,
        connectionRadius: B.connectionRadius,
        domNode: B.domNode,
        nodeLookup: B.nodeLookup,
        lib: B.lib,
        isTarget: N,
        handleId: E,
        nodeId: C,
        flowId: B.rfId,
        panBy: B.panBy,
        cancelConnection: B.cancelConnection,
        onConnectStart: B.onConnectStart,
        onConnectEnd: (...X) => _.getState().onConnectEnd?.(...X),
        updateConnection: B.updateConnection,
        onConnect: me,
        isValidConnection: s || ((...X) => _.getState().isValidConnection?.(...X) ?? !0),
        getTransform: () => _.getState().transform,
        getFromHandle: () => _.getState().connection.fromHandle,
        autoPanSpeed: B.autoPanSpeed,
        dragThreshold: B.connectionDragThreshold
      });
    }
    j ? g?.(Y) : p?.(Y);
  }, O = (Y) => {
    const { onClickConnectStart: j, onClickConnectEnd: B, connectionClickStartHandle: X, connectionMode: J, isValidConnection: I, lib: ae, rfId: he, nodeLookup: Ee, connection: L } = _.getState();
    if (!C || !X && !o)
      return;
    if (!X) {
      j?.(Y.nativeEvent, { nodeId: C, handleId: E, handleType: n }), _.setState({ connectionClickStartHandle: { nodeId: C, type: n, id: E } });
      return;
    }
    const ce = yS(Y.target), pe = s || I, { connection: Se, isValid: le } = bp.isValid(Y.nativeEvent, {
      handle: {
        nodeId: C,
        id: E,
        type: n
      },
      connectionMode: J,
      fromNodeId: X.nodeId,
      fromHandleId: X.id || null,
      fromType: X.type,
      isValidConnection: pe,
      flowId: he,
      doc: ce,
      lib: ae,
      nodeLookup: Ee
    });
    le && Se && me(Se);
    const Te = structuredClone(L);
    delete Te.inProgress, Te.toPosition = Te.toHandle ? Te.toHandle.position : null, B?.(Y, Te), _.setState({ connectionClickStartHandle: null });
  };
  return d.jsx("div", { "data-handleid": E, "data-nodeid": C, "data-handlepos": a, "data-id": `${R}-${C}-${E}-${n}`, className: An([
    "react-flow__handle",
    `react-flow__handle-${a}`,
    "nodrag",
    M,
    y,
    {
      source: !N,
      target: N,
      connectable: r,
      connectablestart: o,
      connectableend: f,
      clickconnecting: k,
      connectingfrom: Q,
      connectingto: V,
      valid: ee,
      /*
       * shows where you can start a connection from
       * and where you can end it while connecting
       */
      connectionindicator: r && (!q || H) && (q || de ? f : o)
    }
  ]), onMouseDown: te, onTouchStart: te, onClick: D ? O : void 0, ref: w, ...S, children: v });
}
const po = A.memo(qS(yz));
function vz({ data: n, isConnectable: a, sourcePosition: s = Ue.Bottom }) {
  return d.jsxs(d.Fragment, { children: [n?.label, d.jsx(po, { type: "source", position: s, isConnectable: a })] });
}
function xz({ data: n, isConnectable: a, targetPosition: s = Ue.Top, sourcePosition: r = Ue.Bottom }) {
  return d.jsxs(d.Fragment, { children: [d.jsx(po, { type: "target", position: s, isConnectable: a }), n?.label, d.jsx(po, { type: "source", position: r, isConnectable: a })] });
}
function bz() {
  return null;
}
function Sz({ data: n, isConnectable: a, targetPosition: s = Ue.Top }) {
  return d.jsxs(d.Fragment, { children: [d.jsx(po, { type: "target", position: s, isConnectable: a }), n?.label] });
}
const $f = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }
}, S1 = {
  input: vz,
  default: xz,
  output: Sz,
  group: bz
};
function wz(n) {
  return n.internals.handleBounds === void 0 ? {
    width: n.width ?? n.initialWidth ?? n.style?.width,
    height: n.height ?? n.initialHeight ?? n.style?.height
  } : {
    width: n.width ?? n.style?.width,
    height: n.height ?? n.style?.height
  };
}
const _z = (n) => {
  const { width: a, height: s, x: r, y: o } = $c(n.nodeLookup, {
    filter: (f) => !!f.selected
  });
  return {
    width: Da(a) ? a : null,
    height: Da(s) ? s : null,
    userSelectionActive: n.userSelectionActive,
    transformString: `translate(${n.transform[0]}px,${n.transform[1]}px) scale(${n.transform[2]}) translate(${r}px,${o}px)`
  };
};
function Ez({ onSelectionContextMenu: n, noPanClassName: a, disableKeyboardA11y: s }) {
  const r = Xt(), { width: o, height: f, transformString: h, userSelectionActive: m } = gt(_z, Jt), v = XS(), y = A.useRef(null);
  A.useEffect(() => {
    s || y.current?.focus({
      preventScroll: !0
    });
  }, [s]);
  const g = !m && o !== null && f !== null;
  if (IS({
    nodeRef: y,
    disabled: !g
  }), !g)
    return null;
  const p = n ? (w) => {
    const E = r.getState().nodes.filter((N) => N.selected);
    n(w, E);
  } : void 0, S = (w) => {
    Object.prototype.hasOwnProperty.call($f, w.key) && (w.preventDefault(), v({
      direction: $f[w.key],
      factor: w.shiftKey ? 4 : 1
    }));
  };
  return d.jsx("div", { className: An(["react-flow__nodesselection", "react-flow__container", a]), style: {
    transform: h
  }, children: d.jsx("div", { ref: y, className: "react-flow__nodesselection-rect", onContextMenu: p, tabIndex: s ? void 0 : -1, onKeyDown: s ? void 0 : S, style: {
    width: o,
    height: f
  } }) });
}
const w1 = typeof window < "u" ? window : void 0, Nz = (n) => ({ nodesSelectionActive: n.nodesSelectionActive, userSelectionActive: n.userSelectionActive });
function QS({ children: n, onPaneClick: a, onPaneMouseEnter: s, onPaneMouseMove: r, onPaneMouseLeave: o, onPaneContextMenu: f, onPaneScroll: h, paneClickDistance: m, deleteKeyCode: v, selectionKeyCode: y, selectionOnDrag: g, selectionMode: p, onSelectionStart: S, onSelectionEnd: w, multiSelectionKeyCode: E, panActivationKeyCode: N, zoomActivationKeyCode: _, elementsSelectable: C, zoomOnScroll: D, zoomOnPinch: M, panOnScroll: R, panOnScrollSpeed: Q, panOnScrollMode: V, zoomOnDoubleClick: k, panOnDrag: H, autoPanOnSelection: q, defaultViewport: de, translateExtent: ee, minZoom: me, maxZoom: te, preventScrolling: O, onSelectionContextMenu: Y, noWheelClassName: j, noPanClassName: B, disableKeyboardA11y: X, onViewportChange: J, isControlledViewport: I }) {
  const { nodesSelectionActive: ae, userSelectionActive: he } = gt(Nz, Jt), Ee = Dc(y, { target: w1 }), L = Dc(N, { target: w1 }), ce = L || H, pe = L || R, Se = g && ce !== !0, le = Ee || he || Se;
  return nz({ deleteKeyCode: v, multiSelectionKeyCode: E }), d.jsx(lz, { onPaneContextMenu: f, elementsSelectable: C, zoomOnScroll: D, zoomOnPinch: M, panOnScroll: pe, panActivationKeyPressed: L, panOnScrollSpeed: Q, panOnScrollMode: V, zoomOnDoubleClick: k, panOnDrag: !Ee && ce, defaultViewport: de, translateExtent: ee, minZoom: me, maxZoom: te, zoomActivationKeyCode: _, preventScrolling: O, noWheelClassName: j, noPanClassName: B, onViewportChange: J, isControlledViewport: I, paneClickDistance: m, selectionOnDrag: Se, children: d.jsxs(cz, { onSelectionStart: S, onSelectionEnd: w, onPaneClick: a, onPaneMouseEnter: s, onPaneMouseMove: r, onPaneMouseLeave: o, onPaneContextMenu: f, onPaneScroll: h, panOnDrag: ce, autoPanOnSelection: q, isSelecting: !!le, selectionMode: p, selectionKeyPressed: Ee, paneClickDistance: m, selectionOnDrag: Se, children: [n, ae && d.jsx(Ez, { onSelectionContextMenu: Y, noPanClassName: B, disableKeyboardA11y: X })] }) });
}
QS.displayName = "FlowRenderer";
const Tz = A.memo(QS), Cz = (n) => (a) => n ? Yp(a.nodeLookup, { x: 0, y: 0, width: a.width, height: a.height }, a.transform, !0).map((s) => s.id) : Array.from(a.nodeLookup.keys());
function Az(n) {
  return gt(A.useCallback(Cz(n), [n]), Jt);
}
const Mz = (n) => n.updateNodeInternals;
function zz() {
  const n = gt(Mz), [a] = A.useState(() => typeof ResizeObserver > "u" ? null : new ResizeObserver((s) => {
    const r = /* @__PURE__ */ new Map();
    s.forEach((o) => {
      const f = o.target.getAttribute("data-id");
      r.set(f, {
        id: f,
        nodeElement: o.target,
        force: !0
      });
    }), n(r);
  }));
  return A.useEffect(() => () => {
    a?.disconnect();
  }, [a]), a;
}
function kz({ node: n, nodeType: a, hasDimensions: s, resizeObserver: r }) {
  const o = Xt(), f = A.useRef(null), h = A.useRef(null), m = A.useRef(n.sourcePosition), v = A.useRef(n.targetPosition), y = A.useRef(a), g = s && !!n.internals.handleBounds;
  return A.useEffect(() => {
    f.current && !n.hidden && (!g || h.current !== f.current) && (h.current && r?.unobserve(h.current), r?.observe(f.current), h.current = f.current);
  }, [g, n.hidden]), A.useEffect(() => () => {
    h.current && (r?.unobserve(h.current), h.current = null);
  }, []), A.useEffect(() => {
    if (f.current) {
      const p = y.current !== a, S = m.current !== n.sourcePosition, w = v.current !== n.targetPosition;
      (p || S || w) && (y.current = a, m.current = n.sourcePosition, v.current = n.targetPosition, o.getState().updateNodeInternals(/* @__PURE__ */ new Map([[n.id, { id: n.id, nodeElement: f.current, force: !0 }]])));
    }
  }, [n.id, a, n.sourcePosition, n.targetPosition]), f;
}
function jz({ id: n, onClick: a, onMouseEnter: s, onMouseMove: r, onMouseLeave: o, onContextMenu: f, onDoubleClick: h, nodesDraggable: m, elementsSelectable: v, nodesConnectable: y, nodesFocusable: g, resizeObserver: p, noDragClassName: S, noPanClassName: w, disableKeyboardA11y: E, rfId: N, nodeTypes: _, nodeClickDistance: C, onError: D }) {
  const { node: M, internals: R, isParent: Q } = gt((le) => {
    const Te = le.nodeLookup.get(n), Ce = le.parentLookup.has(n);
    return {
      node: Te,
      internals: Te.internals,
      isParent: Ce
    };
  }, Jt);
  let V = M.type || "default", k = _?.[V] || S1[V];
  k === void 0 && (D?.("003", Ua.error003(V)), V = "default", k = _?.default || S1.default);
  const H = !!(M.draggable || m && typeof M.draggable > "u"), q = !!(M.selectable || v && typeof M.selectable > "u"), de = !!(M.connectable || y && typeof M.connectable > "u"), ee = !!(M.focusable || g && typeof M.focusable > "u"), me = Xt(), te = mS(M), O = kz({ node: M, nodeType: V, hasDimensions: te, resizeObserver: p }), Y = IS({
    nodeRef: O,
    disabled: M.hidden || !H,
    noDragClassName: S,
    handleSelector: M.dragHandle,
    nodeId: n,
    isSelectable: q,
    nodeClickDistance: C
  }), j = XS();
  if (M.hidden)
    return null;
  const B = $a(M), X = wz(M), J = q || H || a || s || r || o, I = s ? (le) => s(le, { ...R.userNode }) : void 0, ae = r ? (le) => r(le, { ...R.userNode }) : void 0, he = o ? (le) => o(le, { ...R.userNode }) : void 0, Ee = f ? (le) => f(le, { ...R.userNode }) : void 0, L = h ? (le) => h(le, { ...R.userNode }) : void 0, ce = (le) => {
    const { selectNodesOnDrag: Te, nodeDragThreshold: Ce } = me.getState();
    q && (!Te || !H || Ce > 0) && Sp({
      id: n,
      store: me,
      nodeRef: O
    }), a && a(le, { ...R.userNode });
  }, pe = (le) => {
    if (!(vS(le.nativeEvent) || E)) {
      if (lS.includes(le.key) && q) {
        const Te = le.key === "Escape";
        Sp({
          id: n,
          store: me,
          unselect: Te,
          nodeRef: O
        });
      } else if (H && M.selected && Object.prototype.hasOwnProperty.call($f, le.key)) {
        le.preventDefault();
        const { ariaLabelConfig: Te } = me.getState();
        me.setState({
          ariaLiveMessage: Te["node.a11yDescription.ariaLiveMessage"]({
            direction: le.key.replace("Arrow", "").toLowerCase(),
            x: ~~R.positionAbsolute.x,
            y: ~~R.positionAbsolute.y
          })
        }), j({
          direction: $f[le.key],
          factor: le.shiftKey ? 4 : 1
        });
      }
    }
  }, Se = () => {
    if (E || !O.current?.matches(":focus-visible"))
      return;
    const { transform: le, width: Te, height: Ce, autoPanOnNodeFocus: we, setCenter: Ne } = me.getState();
    if (!we)
      return;
    Yp(/* @__PURE__ */ new Map([[n, M]]), { x: 0, y: 0, width: Te, height: Ce }, le, !0).length > 0 || Ne(M.position.x + B.width / 2, M.position.y + B.height / 2, {
      zoom: le[2]
    });
  };
  return d.jsx("div", { className: An([
    "react-flow__node",
    `react-flow__node-${V}`,
    {
      // this is overwritable by passing `nopan` as a class name
      [w]: H
    },
    M.className,
    {
      selected: M.selected,
      selectable: q,
      parent: Q,
      draggable: H,
      dragging: Y
    }
  ]), ref: O, style: {
    zIndex: R.z,
    transform: `translate(${R.positionAbsolute.x}px,${R.positionAbsolute.y}px)`,
    pointerEvents: J ? "all" : "none",
    visibility: te ? "visible" : "hidden",
    ...M.style,
    ...X
  }, "data-id": n, "data-testid": `rf__node-${n}`, onMouseEnter: I, onMouseMove: ae, onMouseLeave: he, onContextMenu: Ee, onClick: ce, onDoubleClick: L, onKeyDown: ee ? pe : void 0, tabIndex: ee ? 0 : void 0, onFocus: ee ? Se : void 0, role: M.ariaRole ?? (ee ? "group" : void 0), "aria-roledescription": "node", "aria-describedby": E ? void 0 : `${LS}-${N}`, "aria-label": M.ariaLabel, ...M.domAttributes, children: d.jsx(fz, { value: n, children: d.jsx(k, { id: n, data: M.data, type: V, positionAbsoluteX: R.positionAbsolute.x, positionAbsoluteY: R.positionAbsolute.y, selected: M.selected ?? !1, selectable: q, draggable: H, deletable: M.deletable ?? !0, isConnectable: de, sourcePosition: M.sourcePosition, targetPosition: M.targetPosition, dragging: Y, dragHandle: M.dragHandle, zIndex: R.z, parentId: M.parentId, ...B }) }) });
}
var Rz = A.memo(jz);
const Oz = (n) => ({
  nodesConnectable: n.nodesConnectable,
  nodesFocusable: n.nodesFocusable,
  elementsSelectable: n.elementsSelectable,
  onError: n.onError
});
function KS(n) {
  const { nodesConnectable: a, nodesFocusable: s, elementsSelectable: r, onError: o } = gt(Oz, Jt), f = Az(n.onlyRenderVisibleElements), h = zz();
  return d.jsx("div", { className: "react-flow__nodes", style: ad, children: f.map((m) => (
    /*
     * The split of responsibilities between NodeRenderer and
     * NodeComponentWrapper may appear weird. However, it’s designed to
     * minimize the cost of updates when individual nodes change.
     *
     * For example, when you’re dragging a single node, that node gets
     * updated multiple times per second. If `NodeRenderer` were to update
     * every time, it would have to re-run the `nodes.map()` loop every
     * time. This gets pricey with hundreds of nodes, especially if every
     * loop cycle does more than just rendering a JSX element!
     *
     * As a result of this choice, we took the following implementation
     * decisions:
     * - NodeRenderer subscribes *only* to node IDs – and therefore
     *   rerender *only* when visible nodes are added or removed.
     * - NodeRenderer performs all operations the result of which can be
     *   shared between nodes (such as creating the `ResizeObserver`
     *   instance, or subscribing to `selector`). This means extra prop
     *   drilling into `NodeComponentWrapper`, but it means we need to run
     *   these operations only once – instead of once per node.
     * - Any operations that you’d normally write inside `nodes.map` are
     *   moved into `NodeComponentWrapper`. This ensures they are
     *   memorized – so if `NodeRenderer` *has* to rerender, it only
     *   needs to regenerate the list of nodes, nothing else.
     */
    d.jsx(Rz, { id: m, nodeTypes: n.nodeTypes, nodeExtent: n.nodeExtent, onClick: n.onNodeClick, onMouseEnter: n.onNodeMouseEnter, onMouseMove: n.onNodeMouseMove, onMouseLeave: n.onNodeMouseLeave, onContextMenu: n.onNodeContextMenu, onDoubleClick: n.onNodeDoubleClick, noDragClassName: n.noDragClassName, noPanClassName: n.noPanClassName, rfId: n.rfId, disableKeyboardA11y: n.disableKeyboardA11y, resizeObserver: h, nodesDraggable: n.nodesDraggable ?? !0, nodesConnectable: a, nodesFocusable: s, elementsSelectable: r, nodeClickDistance: n.nodeClickDistance, onError: o }, m)
  )) });
}
KS.displayName = "NodeRenderer";
const Dz = A.memo(KS);
function Hz(n) {
  return gt(A.useCallback((s) => {
    if (!n)
      return s.edges.map((o) => o.id);
    const r = [];
    if (s.width && s.height)
      for (const o of s.edges) {
        const f = s.nodeLookup.get(o.source), h = s.nodeLookup.get(o.target);
        f && h && TA({
          sourceNode: f,
          targetNode: h,
          width: s.width,
          height: s.height,
          transform: s.transform
        }) && r.push(o.id);
      }
    return r;
  }, [n]), Jt);
}
const Lz = ({ color: n = "none", strokeWidth: a = 1 }) => {
  const s = {
    strokeWidth: a,
    ...n && { stroke: n }
  };
  return d.jsx("polyline", { className: "arrow", style: s, strokeLinecap: "round", fill: "none", strokeLinejoin: "round", points: "-5,-4 0,0 -5,4" });
}, Uz = ({ color: n = "none", strokeWidth: a = 1 }) => {
  const s = {
    strokeWidth: a,
    ...n && { stroke: n, fill: n }
  };
  return d.jsx("polyline", { className: "arrowclosed", style: s, strokeLinecap: "round", strokeLinejoin: "round", points: "-5,-4 0,0 -5,4 -5,-4" });
}, _1 = {
  [Lf.Arrow]: Lz,
  [Lf.ArrowClosed]: Uz
};
function Bz(n) {
  const a = Xt();
  return A.useMemo(() => Object.prototype.hasOwnProperty.call(_1, n) ? _1[n] : (a.getState().onError?.("009", Ua.error009(n)), null), [n]);
}
const $z = ({ id: n, type: a, color: s, width: r = 12.5, height: o = 12.5, markerUnits: f = "strokeWidth", strokeWidth: h, orient: m = "auto-start-reverse" }) => {
  const v = Bz(a);
  return v ? d.jsx("marker", { className: "react-flow__arrowhead", id: n, markerWidth: `${r}`, markerHeight: `${o}`, viewBox: "-10 -10 20 20", markerUnits: f, orient: m, refX: "0", refY: "0", children: d.jsx(v, { color: s, strokeWidth: h }) }) : null;
}, PS = ({ defaultColor: n, rfId: a }) => {
  const s = gt((f) => f.edges), r = gt((f) => f.defaultEdgeOptions), o = A.useMemo(() => DA(s, {
    id: a,
    defaultColor: n,
    defaultMarkerStart: r?.markerStart,
    defaultMarkerEnd: r?.markerEnd
  }), [s, r, a, n]);
  return o.length ? d.jsx("svg", { className: "react-flow__marker", "aria-hidden": "true", children: d.jsx("defs", { children: o.map((f) => d.jsx($z, { id: f.id, type: f.type, color: f.color, width: f.width, height: f.height, markerUnits: f.markerUnits, strokeWidth: f.strokeWidth, orient: f.orient }, f.id)) }) }) : null;
};
PS.displayName = "MarkerDefinitions";
var qz = A.memo(PS);
function JS({ x: n, y: a, label: s, labelStyle: r, labelShowBg: o = !0, labelBgStyle: f, labelBgPadding: h = [2, 4], labelBgBorderRadius: m = 2, children: v, className: y, ...g }) {
  const [p, S] = A.useState({ x: 1, y: 0, width: 0, height: 0 }), w = An(["react-flow__edge-textwrapper", y]), E = A.useRef(null);
  return A.useEffect(() => {
    if (E.current) {
      const N = E.current.getBBox();
      S({
        x: N.x,
        y: N.y,
        width: N.width,
        height: N.height
      });
    }
  }, [s]), s ? d.jsxs("g", { transform: `translate(${n - p.width / 2} ${a - p.height / 2})`, className: w, visibility: p.width ? "visible" : "hidden", ...g, children: [o && d.jsx("rect", { width: p.width + 2 * h[0], x: -h[0], y: -h[1], height: p.height + 2 * h[1], className: "react-flow__edge-textbg", style: f, rx: m, ry: m }), d.jsx("text", { className: "react-flow__edge-text", y: p.height / 2, dy: "0.3em", ref: E, style: r, children: s }), v] }) : null;
}
JS.displayName = "EdgeText";
const Vz = A.memo(JS);
function ld({ path: n, labelX: a, labelY: s, label: r, labelStyle: o, labelShowBg: f, labelBgStyle: h, labelBgPadding: m, labelBgBorderRadius: v, interactionWidth: y = 20, ...g }) {
  return d.jsxs(d.Fragment, { children: [d.jsx("path", { ...g, d: n, fill: "none", className: An(["react-flow__edge-path", g.className]) }), y ? d.jsx("path", { d: n, fill: "none", strokeOpacity: 0, strokeWidth: y, className: "react-flow__edge-interaction" }) : null, r && Da(a) && Da(s) ? d.jsx(Vz, { x: a, y: s, label: r, labelStyle: o, labelShowBg: f, labelBgStyle: h, labelBgPadding: m, labelBgBorderRadius: v }) : null] });
}
function E1({ pos: n, x1: a, y1: s, x2: r, y2: o }) {
  return n === Ue.Left || n === Ue.Right ? [0.5 * (a + r), s] : [a, 0.5 * (s + o)];
}
function FS({ sourceX: n, sourceY: a, sourcePosition: s = Ue.Bottom, targetX: r, targetY: o, targetPosition: f = Ue.Top }) {
  const [h, m] = E1({
    pos: s,
    x1: n,
    y1: a,
    x2: r,
    y2: o
  }), [v, y] = E1({
    pos: f,
    x1: r,
    y1: o,
    x2: n,
    y2: a
  }), [g, p, S, w] = bS({
    sourceX: n,
    sourceY: a,
    targetX: r,
    targetY: o,
    sourceControlX: h,
    sourceControlY: m,
    targetControlX: v,
    targetControlY: y
  });
  return [
    `M${n},${a} C${h},${m} ${v},${y} ${r},${o}`,
    g,
    p,
    S,
    w
  ];
}
function WS(n) {
  return A.memo(({ id: a, sourceX: s, sourceY: r, targetX: o, targetY: f, sourcePosition: h, targetPosition: m, label: v, labelStyle: y, labelShowBg: g, labelBgStyle: p, labelBgPadding: S, labelBgBorderRadius: w, style: E, markerEnd: N, markerStart: _, interactionWidth: C }) => {
    const [D, M, R] = FS({
      sourceX: s,
      sourceY: r,
      sourcePosition: h,
      targetX: o,
      targetY: f,
      targetPosition: m
    }), Q = n.isInternal ? void 0 : a;
    return d.jsx(ld, { id: Q, path: D, labelX: M, labelY: R, label: v, labelStyle: y, labelShowBg: g, labelBgStyle: p, labelBgPadding: S, labelBgBorderRadius: w, style: E, markerEnd: N, markerStart: _, interactionWidth: C });
  });
}
const Yz = WS({ isInternal: !1 }), ew = WS({ isInternal: !0 });
Yz.displayName = "SimpleBezierEdge";
ew.displayName = "SimpleBezierEdgeInternal";
function tw(n) {
  return A.memo(({ id: a, sourceX: s, sourceY: r, targetX: o, targetY: f, label: h, labelStyle: m, labelShowBg: v, labelBgStyle: y, labelBgPadding: g, labelBgBorderRadius: p, style: S, sourcePosition: w = Ue.Bottom, targetPosition: E = Ue.Top, markerEnd: N, markerStart: _, pathOptions: C, interactionWidth: D }) => {
    const [M, R, Q] = yp({
      sourceX: s,
      sourceY: r,
      sourcePosition: w,
      targetX: o,
      targetY: f,
      targetPosition: E,
      borderRadius: C?.borderRadius,
      offset: C?.offset,
      stepPosition: C?.stepPosition
    }), V = n.isInternal ? void 0 : a;
    return d.jsx(ld, { id: V, path: M, labelX: R, labelY: Q, label: h, labelStyle: m, labelShowBg: v, labelBgStyle: y, labelBgPadding: g, labelBgBorderRadius: p, style: S, markerEnd: N, markerStart: _, interactionWidth: D });
  });
}
const nw = tw({ isInternal: !1 }), iw = tw({ isInternal: !0 });
nw.displayName = "SmoothStepEdge";
iw.displayName = "SmoothStepEdgeInternal";
function aw(n) {
  return A.memo(({ id: a, ...s }) => {
    const r = n.isInternal ? void 0 : a;
    return d.jsx(nw, { ...s, id: r, pathOptions: A.useMemo(() => ({ borderRadius: 0, offset: s.pathOptions?.offset }), [s.pathOptions?.offset]) });
  });
}
const Iz = aw({ isInternal: !1 }), lw = aw({ isInternal: !0 });
Iz.displayName = "StepEdge";
lw.displayName = "StepEdgeInternal";
function sw(n) {
  return A.memo(({ id: a, sourceX: s, sourceY: r, targetX: o, targetY: f, label: h, labelStyle: m, labelShowBg: v, labelBgStyle: y, labelBgPadding: g, labelBgBorderRadius: p, style: S, markerEnd: w, markerStart: E, interactionWidth: N }) => {
    const [_, C, D] = _S({ sourceX: s, sourceY: r, targetX: o, targetY: f }), M = n.isInternal ? void 0 : a;
    return d.jsx(ld, { id: M, path: _, labelX: C, labelY: D, label: h, labelStyle: m, labelShowBg: v, labelBgStyle: y, labelBgPadding: g, labelBgBorderRadius: p, style: S, markerEnd: w, markerStart: E, interactionWidth: N });
  });
}
const Xz = sw({ isInternal: !1 }), rw = sw({ isInternal: !0 });
Xz.displayName = "StraightEdge";
rw.displayName = "StraightEdgeInternal";
function ow(n) {
  return A.memo(({ id: a, sourceX: s, sourceY: r, targetX: o, targetY: f, sourcePosition: h = Ue.Bottom, targetPosition: m = Ue.Top, label: v, labelStyle: y, labelShowBg: g, labelBgStyle: p, labelBgPadding: S, labelBgBorderRadius: w, style: E, markerEnd: N, markerStart: _, pathOptions: C, interactionWidth: D }) => {
    const [M, R, Q] = SS({
      sourceX: s,
      sourceY: r,
      sourcePosition: h,
      targetX: o,
      targetY: f,
      targetPosition: m,
      curvature: C?.curvature
    }), V = n.isInternal ? void 0 : a;
    return d.jsx(ld, { id: V, path: M, labelX: R, labelY: Q, label: v, labelStyle: y, labelShowBg: g, labelBgStyle: p, labelBgPadding: S, labelBgBorderRadius: w, style: E, markerEnd: N, markerStart: _, interactionWidth: D });
  });
}
const Gz = ow({ isInternal: !1 }), cw = ow({ isInternal: !0 });
Gz.displayName = "BezierEdge";
cw.displayName = "BezierEdgeInternal";
const N1 = {
  default: cw,
  straight: rw,
  step: lw,
  smoothstep: iw,
  simplebezier: ew
}, T1 = {
  sourceX: null,
  sourceY: null,
  targetX: null,
  targetY: null,
  sourcePosition: null,
  targetPosition: null,
  zIndex: void 0
}, Zz = (n, a, s) => s === Ue.Left ? n - a : s === Ue.Right ? n + a : n, Qz = (n, a, s) => s === Ue.Top ? n - a : s === Ue.Bottom ? n + a : n, C1 = "react-flow__edgeupdater";
function A1({ position: n, centerX: a, centerY: s, radius: r = 10, onMouseDown: o, onMouseEnter: f, onMouseOut: h, type: m }) {
  return d.jsx("circle", { onMouseDown: o, onMouseEnter: f, onMouseOut: h, className: An([C1, `${C1}-${m}`]), cx: Zz(a, r, n), cy: Qz(s, r, n), r, stroke: "transparent", fill: "transparent" });
}
function Kz({ isReconnectable: n, reconnectRadius: a, edge: s, sourceX: r, sourceY: o, targetX: f, targetY: h, sourcePosition: m, targetPosition: v, onReconnect: y, onReconnectStart: g, onReconnectEnd: p, setReconnecting: S, setUpdateHover: w }) {
  const E = Xt(), N = (R, Q) => {
    if (R.button !== 0)
      return;
    const { autoPanOnConnect: V, domNode: k, connectionMode: H, connectionRadius: q, lib: de, onConnectStart: ee, cancelConnection: me, nodeLookup: te, rfId: O, panBy: Y, updateConnection: j } = E.getState(), B = Q.type === "target", X = (ae, he) => {
      S(!1), p?.(ae, s, Q.type, he);
    }, J = (ae) => y?.(s, ae), I = (ae, he) => {
      S(!0), g?.(R, s, Q.type), ee?.(ae, he);
    };
    bp.onPointerDown(R.nativeEvent, {
      autoPanOnConnect: V,
      connectionMode: H,
      connectionRadius: q,
      domNode: k,
      handleId: Q.id,
      nodeId: Q.nodeId,
      nodeLookup: te,
      isTarget: B,
      edgeUpdaterType: Q.type,
      lib: de,
      flowId: O,
      cancelConnection: me,
      panBy: Y,
      isValidConnection: (...ae) => E.getState().isValidConnection?.(...ae) ?? !0,
      onConnect: J,
      onConnectStart: I,
      onConnectEnd: (...ae) => E.getState().onConnectEnd?.(...ae),
      onReconnectEnd: X,
      updateConnection: j,
      getTransform: () => E.getState().transform,
      getFromHandle: () => E.getState().connection.fromHandle,
      dragThreshold: E.getState().connectionDragThreshold,
      handleDomNode: R.currentTarget
    });
  }, _ = (R) => N(R, { nodeId: s.target, id: s.targetHandle ?? null, type: "target" }), C = (R) => N(R, { nodeId: s.source, id: s.sourceHandle ?? null, type: "source" }), D = () => w(!0), M = () => w(!1);
  return d.jsxs(d.Fragment, { children: [(n === !0 || n === "source") && d.jsx(A1, { position: m, centerX: r, centerY: o, radius: a, onMouseDown: _, onMouseEnter: D, onMouseOut: M, type: "source" }), (n === !0 || n === "target") && d.jsx(A1, { position: v, centerX: f, centerY: h, radius: a, onMouseDown: C, onMouseEnter: D, onMouseOut: M, type: "target" })] });
}
function Pz({ id: n, edgesFocusable: a, edgesReconnectable: s, elementsSelectable: r, onClick: o, onDoubleClick: f, onContextMenu: h, onMouseEnter: m, onMouseMove: v, onMouseLeave: y, reconnectRadius: g, onReconnect: p, onReconnectStart: S, onReconnectEnd: w, rfId: E, edgeTypes: N, noPanClassName: _, onError: C, disableKeyboardA11y: D }) {
  let M = gt((Ne) => Ne.edgeLookup.get(n));
  const R = gt((Ne) => Ne.defaultEdgeOptions);
  M = R ? { ...R, ...M } : M;
  let Q = M.type || "default", V = N?.[Q] || N1[Q];
  V === void 0 && (C?.("011", Ua.error011(Q)), Q = "default", V = N?.default || N1.default);
  const k = !!(M.focusable || a && typeof M.focusable > "u"), H = typeof p < "u" && (M.reconnectable || s && typeof M.reconnectable > "u"), q = !!(M.selectable || r && typeof M.selectable > "u"), de = A.useRef(null), [ee, me] = A.useState(!1), [te, O] = A.useState(!1), Y = Xt(), { zIndex: j = M.zIndex, sourceX: B, sourceY: X, targetX: J, targetY: I, sourcePosition: ae, targetPosition: he } = gt(A.useCallback((Ne) => {
    const ze = Ne.nodeLookup.get(M.source), Ve = Ne.nodeLookup.get(M.target);
    if (!ze || !Ve)
      return T1;
    const $e = OA({
      id: n,
      sourceNode: ze,
      targetNode: Ve,
      sourceHandle: M.sourceHandle || null,
      targetHandle: M.targetHandle || null,
      connectionMode: Ne.connectionMode,
      onError: C
    }), Me = NA({
      selected: M.selected,
      zIndex: M.zIndex,
      sourceNode: ze,
      targetNode: Ve,
      elevateOnSelect: Ne.elevateEdgesOnSelect,
      zIndexMode: Ne.zIndexMode
    });
    return {
      ...$e || T1,
      zIndex: Me
    };
  }, [M.source, M.target, M.sourceHandle, M.targetHandle, M.selected, M.zIndex, C]), Jt), Ee = A.useMemo(() => M.markerStart ? `url('#${vp(M.markerStart, E)}')` : void 0, [M.markerStart, E]), L = A.useMemo(() => M.markerEnd ? `url('#${vp(M.markerEnd, E)}')` : void 0, [M.markerEnd, E]);
  if (M.hidden || B === null || X === null || J === null || I === null)
    return null;
  const ce = (Ne) => {
    const { addSelectedEdges: ze, unselectNodesAndEdges: Ve, multiSelectionActive: $e } = Y.getState();
    q && (Y.setState({ nodesSelectionActive: !1 }), M.selected && $e ? (Ve({ nodes: [], edges: [M] }), de.current?.blur()) : ze([n])), o && o(Ne, M);
  }, pe = f ? (Ne) => {
    f(Ne, { ...M });
  } : void 0, Se = h ? (Ne) => {
    h(Ne, { ...M });
  } : void 0, le = m ? (Ne) => {
    m(Ne, { ...M });
  } : void 0, Te = v ? (Ne) => {
    v(Ne, { ...M });
  } : void 0, Ce = y ? (Ne) => {
    y(Ne, { ...M });
  } : void 0, we = (Ne) => {
    if (!D && lS.includes(Ne.key) && q) {
      const { unselectNodesAndEdges: ze, addSelectedEdges: Ve } = Y.getState();
      Ne.key === "Escape" ? (de.current?.blur(), ze({ edges: [M] })) : Ve([n]);
    }
  };
  return d.jsx("svg", { style: { zIndex: j }, children: d.jsxs("g", { className: An([
    "react-flow__edge",
    `react-flow__edge-${Q}`,
    M.className,
    _,
    {
      selected: M.selected,
      animated: M.animated,
      inactive: !q && !o,
      updating: ee,
      selectable: q
    }
  ]), onClick: ce, onDoubleClick: pe, onContextMenu: Se, onMouseEnter: le, onMouseMove: Te, onMouseLeave: Ce, onKeyDown: k ? we : void 0, tabIndex: k ? 0 : void 0, role: M.ariaRole ?? (k ? "group" : "img"), "aria-roledescription": "edge", "data-id": n, "data-testid": `rf__edge-${n}`, "aria-label": M.ariaLabel === null ? void 0 : M.ariaLabel || `Edge from ${M.source} to ${M.target}`, "aria-describedby": k ? `${US}-${E}` : void 0, ref: de, ...M.domAttributes, children: [!te && d.jsx(V, { id: n, source: M.source, target: M.target, type: M.type, selected: M.selected, animated: M.animated, selectable: q, deletable: M.deletable ?? !0, label: M.label, labelStyle: M.labelStyle, labelShowBg: M.labelShowBg, labelBgStyle: M.labelBgStyle, labelBgPadding: M.labelBgPadding, labelBgBorderRadius: M.labelBgBorderRadius, sourceX: B, sourceY: X, targetX: J, targetY: I, sourcePosition: ae, targetPosition: he, data: M.data, style: M.style, sourceHandleId: M.sourceHandle, targetHandleId: M.targetHandle, markerStart: Ee, markerEnd: L, pathOptions: "pathOptions" in M ? M.pathOptions : void 0, interactionWidth: M.interactionWidth }), H && d.jsx(Kz, { edge: M, isReconnectable: H, reconnectRadius: g, onReconnect: p, onReconnectStart: S, onReconnectEnd: w, sourceX: B, sourceY: X, targetX: J, targetY: I, sourcePosition: ae, targetPosition: he, setUpdateHover: me, setReconnecting: O })] }) });
}
var Jz = A.memo(Pz);
const Fz = (n) => ({
  edgesFocusable: n.edgesFocusable,
  edgesReconnectable: n.edgesReconnectable,
  elementsSelectable: n.elementsSelectable,
  connectionMode: n.connectionMode,
  onError: n.onError
});
function uw({ defaultMarkerColor: n, onlyRenderVisibleElements: a, rfId: s, edgeTypes: r, noPanClassName: o, onReconnect: f, onEdgeContextMenu: h, onEdgeMouseEnter: m, onEdgeMouseMove: v, onEdgeMouseLeave: y, onEdgeClick: g, reconnectRadius: p, onEdgeDoubleClick: S, onReconnectStart: w, onReconnectEnd: E, disableKeyboardA11y: N }) {
  const { edgesFocusable: _, edgesReconnectable: C, elementsSelectable: D, onError: M } = gt(Fz, Jt), R = Hz(a);
  return d.jsxs("div", { className: "react-flow__edges", children: [d.jsx(qz, { defaultColor: n, rfId: s }), R.map((Q) => d.jsx(Jz, { id: Q, edgesFocusable: _, edgesReconnectable: C, elementsSelectable: D, noPanClassName: o, onReconnect: f, onContextMenu: h, onMouseEnter: m, onMouseMove: v, onMouseLeave: y, onClick: g, reconnectRadius: p, onDoubleClick: S, onReconnectStart: w, onReconnectEnd: E, rfId: s, onError: M, edgeTypes: r, disableKeyboardA11y: N }, Q))] });
}
uw.displayName = "EdgeRenderer";
const Wz = A.memo(uw), M1 = (n) => `translate(${n[0]}px,${n[1]}px) scale(${n[2]})`;
function ek({ children: n }) {
  const a = Xt(), s = A.useRef(null), [r] = A.useState(() => a.getState().transform);
  return VS(() => {
    let o = null;
    const f = () => {
      const h = a.getState().transform;
      o && h[0] === o[0] && h[1] === o[1] && h[2] === o[2] || (o = h, s.current && (s.current.style.transform = M1(h)));
    };
    return f(), a.subscribe(f);
  }, [a]), d.jsx("div", { ref: s, className: "react-flow__viewport xyflow__viewport react-flow__container", style: { transform: M1(r) }, children: n });
}
function tk(n) {
  const a = id(), s = A.useRef(!1);
  A.useEffect(() => {
    !s.current && a.viewportInitialized && n && (setTimeout(() => n(a), 1), s.current = !0);
  }, [n, a.viewportInitialized]);
}
const nk = (n) => n.panZoom?.syncViewport;
function ik(n) {
  const a = gt(nk), s = Xt();
  return A.useEffect(() => {
    n && (a?.(n), s.setState({ transform: [n.x, n.y, n.zoom] }));
  }, [n, a]), null;
}
function ak(n) {
  return n.connection.inProgress ? { ...n.connection, to: Vc(n.connection.to, n.transform) } : { ...n.connection };
}
function lk(n) {
  return ak;
}
function sk(n) {
  const a = lk();
  return gt(a, Jt);
}
const rk = (n) => ({
  nodesConnectable: n.nodesConnectable,
  isValid: n.connection.isValid,
  inProgress: n.connection.inProgress,
  width: n.width,
  height: n.height
});
function ok({ containerStyle: n, style: a, type: s, component: r }) {
  const { nodesConnectable: o, width: f, height: h, isValid: m, inProgress: v } = gt(rk, Jt);
  return !(f && o && v) ? null : d.jsx("svg", { style: n, width: f, height: h, className: "react-flow__connectionline react-flow__container", children: d.jsx("g", { className: An(["react-flow__connection", gS(m)]), children: d.jsx(fw, { style: a, type: s, CustomComponent: r, isValid: m }) }) });
}
const fw = ({ style: n, type: a = ps.Bezier, CustomComponent: s, isValid: r }) => {
  const { inProgress: o, from: f, fromNode: h, fromHandle: m, fromPosition: v, to: y, toNode: g, toHandle: p, toPosition: S, pointer: w } = sk();
  if (!o)
    return;
  if (s)
    return d.jsx(s, { connectionLineType: a, connectionLineStyle: n, fromNode: h, fromHandle: m, fromX: f.x, fromY: f.y, toX: y.x, toY: y.y, fromPosition: v, toPosition: S, connectionStatus: gS(r), toNode: g, toHandle: p, pointer: w });
  let E = "";
  const N = {
    sourceX: f.x,
    sourceY: f.y,
    sourcePosition: v,
    targetX: y.x,
    targetY: y.y,
    targetPosition: S
  };
  switch (a) {
    case ps.Bezier:
      [E] = SS(N);
      break;
    case ps.SimpleBezier:
      [E] = FS(N);
      break;
    case ps.Step:
      [E] = yp({
        ...N,
        borderRadius: 0
      });
      break;
    case ps.SmoothStep:
      [E] = yp(N);
      break;
    default:
      [E] = _S(N);
  }
  return d.jsx("path", { d: E, fill: "none", className: "react-flow__connection-path", style: n });
};
fw.displayName = "ConnectionLine";
const ck = {};
function z1(n = ck) {
  A.useRef(n), Xt(), A.useEffect(() => {
  }, [n]);
}
function uk() {
  Xt(), A.useRef(!1), A.useEffect(() => {
  }, []);
}
function dw({ nodeTypes: n, edgeTypes: a, onInit: s, onNodeClick: r, onEdgeClick: o, onNodeDoubleClick: f, onEdgeDoubleClick: h, onNodeMouseEnter: m, onNodeMouseMove: v, onNodeMouseLeave: y, onNodeContextMenu: g, onSelectionContextMenu: p, onSelectionStart: S, onSelectionEnd: w, connectionLineType: E, connectionLineStyle: N, connectionLineComponent: _, connectionLineContainerStyle: C, selectionKeyCode: D, selectionOnDrag: M, selectionMode: R, multiSelectionKeyCode: Q, panActivationKeyCode: V, zoomActivationKeyCode: k, deleteKeyCode: H, onlyRenderVisibleElements: q, elementsSelectable: de, defaultViewport: ee, translateExtent: me, minZoom: te, maxZoom: O, preventScrolling: Y, defaultMarkerColor: j, zoomOnScroll: B, zoomOnPinch: X, panOnScroll: J, panOnScrollSpeed: I, panOnScrollMode: ae, zoomOnDoubleClick: he, panOnDrag: Ee, autoPanOnSelection: L, onPaneClick: ce, onPaneMouseEnter: pe, onPaneMouseMove: Se, onPaneMouseLeave: le, onPaneScroll: Te, onPaneContextMenu: Ce, paneClickDistance: we, nodeClickDistance: Ne, onEdgeContextMenu: ze, onEdgeMouseEnter: Ve, onEdgeMouseMove: $e, onEdgeMouseLeave: Me, reconnectRadius: Ge, onReconnect: Re, onReconnectStart: _t, onReconnectEnd: it, noDragClassName: At, noWheelClassName: Mn, noPanClassName: Et, disableKeyboardA11y: sn, nodeExtent: It, rfId: bt, viewport: Nt, onViewportChange: St, nodesDraggable: ft }) {
  return z1(n), z1(a), uk(), tk(s), ik(Nt), d.jsx(Tz, { onPaneClick: ce, onPaneMouseEnter: pe, onPaneMouseMove: Se, onPaneMouseLeave: le, onPaneContextMenu: Ce, onPaneScroll: Te, paneClickDistance: we, deleteKeyCode: H, selectionKeyCode: D, selectionOnDrag: M, selectionMode: R, onSelectionStart: S, onSelectionEnd: w, multiSelectionKeyCode: Q, panActivationKeyCode: V, zoomActivationKeyCode: k, elementsSelectable: de, zoomOnScroll: B, zoomOnPinch: X, zoomOnDoubleClick: he, panOnScroll: J, panOnScrollSpeed: I, panOnScrollMode: ae, panOnDrag: Ee, autoPanOnSelection: L, defaultViewport: ee, translateExtent: me, minZoom: te, maxZoom: O, onSelectionContextMenu: p, preventScrolling: Y, noDragClassName: At, noWheelClassName: Mn, noPanClassName: Et, disableKeyboardA11y: sn, onViewportChange: St, isControlledViewport: !!Nt, children: d.jsxs(ek, { children: [d.jsx(Wz, { edgeTypes: a, onEdgeClick: o, onEdgeDoubleClick: h, onReconnect: Re, onReconnectStart: _t, onReconnectEnd: it, onlyRenderVisibleElements: q, onEdgeContextMenu: ze, onEdgeMouseEnter: Ve, onEdgeMouseMove: $e, onEdgeMouseLeave: Me, reconnectRadius: Ge, defaultMarkerColor: j, noPanClassName: Et, disableKeyboardA11y: sn, rfId: bt }), d.jsx(ok, { style: N, type: E, component: _, containerStyle: C }), d.jsx("div", { className: "react-flow__edgelabel-renderer" }), d.jsx(Dz, { nodeTypes: n, onNodeClick: r, onNodeDoubleClick: f, onNodeMouseEnter: m, onNodeMouseMove: v, onNodeMouseLeave: y, onNodeContextMenu: g, nodeClickDistance: Ne, onlyRenderVisibleElements: q, noPanClassName: Et, noDragClassName: At, disableKeyboardA11y: sn, nodeExtent: It, rfId: bt, nodesDraggable: ft }), d.jsx("div", { className: "react-flow__viewport-portal" })] }) });
}
dw.displayName = "GraphView";
const fk = A.memo(dw), dk = hS(), k1 = ({ nodes: n, edges: a, defaultNodes: s, defaultEdges: r, width: o, height: f, fitView: h, fitViewOptions: m, minZoom: v = 0.5, maxZoom: y = 2, nodeOrigin: g, nodeExtent: p, zIndexMode: S = "basic" } = {}) => {
  const w = /* @__PURE__ */ new Map(), E = /* @__PURE__ */ new Map(), N = /* @__PURE__ */ new Map(), _ = /* @__PURE__ */ new Map(), C = r ?? a ?? [], D = s ?? n ?? [], M = g ?? [0, 0], R = p ?? jc;
  TS(N, _, C);
  const { nodesInitialized: Q } = xp(D, w, E, {
    nodeOrigin: M,
    nodeExtent: R,
    zIndexMode: S
  });
  let V = [0, 0, 1];
  if (h && o && f) {
    const k = $c(w, {
      filter: (ee) => !!((ee.width || ee.initialWidth) && (ee.height || ee.initialHeight))
    }), { x: H, y: q, zoom: de } = Xp(k, o, f, v, y, m?.padding ?? 0.1);
    V = [H, q, de];
  }
  return {
    rfId: "1",
    width: o ?? 0,
    height: f ?? 0,
    transform: V,
    nodes: D,
    nodesInitialized: Q,
    nodeLookup: w,
    parentLookup: E,
    edges: C,
    edgeLookup: _,
    connectionLookup: N,
    onNodesChange: null,
    onEdgesChange: null,
    hasDefaultNodes: s !== void 0,
    hasDefaultEdges: r !== void 0,
    panZoom: null,
    minZoom: v,
    maxZoom: y,
    translateExtent: jc,
    nodeExtent: R,
    nodesSelectionActive: !1,
    userSelectionActive: !1,
    userSelectionRect: null,
    connectionMode: uo.Strict,
    domNode: null,
    paneDragging: !1,
    noPanClassName: "nopan",
    nodeOrigin: M,
    nodeDragThreshold: 1,
    connectionDragThreshold: 1,
    snapGrid: [15, 15],
    snapToGrid: !1,
    nodesDraggable: !0,
    nodesConnectable: !0,
    nodesFocusable: !0,
    edgesFocusable: !0,
    edgesReconnectable: !0,
    elementsSelectable: !0,
    elevateNodesOnSelect: !0,
    elevateEdgesOnSelect: !0,
    selectNodesOnDrag: !0,
    multiSelectionActive: !1,
    fitViewQueued: h ?? !1,
    fitViewOptions: m,
    fitViewResolver: null,
    connection: { ...rS },
    connectionClickStartHandle: null,
    connectOnClick: !0,
    ariaLiveMessage: "",
    autoPanOnConnect: !0,
    autoPanOnNodeDrag: !0,
    autoPanOnNodeFocus: !0,
    autoPanSpeed: 15,
    connectionRadius: 20,
    onError: dk,
    isValidConnection: void 0,
    onSelectionChangeHandlers: [],
    lib: "react",
    debug: !1,
    ariaLabelConfig: sS,
    zIndexMode: S,
    defaultEdgeOptions: void 0,
    onNodesChangeMiddlewareMap: /* @__PURE__ */ new Map(),
    onEdgesChangeMiddlewareMap: /* @__PURE__ */ new Map(),
    onNodesDelete: void 0,
    onEdgesDelete: void 0,
    onDelete: void 0,
    onBeforeDelete: void 0,
    onViewportChangeStart: void 0,
    onViewportChange: void 0,
    onViewportChangeEnd: void 0,
    onNodeDragStart: void 0,
    onNodeDrag: void 0,
    onNodeDragStop: void 0,
    onSelectionDragStart: void 0,
    onSelectionDrag: void 0,
    onSelectionDragStop: void 0,
    onMoveStart: void 0,
    onMove: void 0,
    onMoveEnd: void 0,
    onConnect: void 0,
    onConnectStart: void 0,
    onConnectEnd: void 0,
    onClickConnectStart: void 0,
    onClickConnectEnd: void 0
  };
}, hk = ({ nodes: n, edges: a, defaultNodes: s, defaultEdges: r, width: o, height: f, fitView: h, fitViewOptions: m, minZoom: v, maxZoom: y, nodeOrigin: g, nodeExtent: p, zIndexMode: S }) => NM((w, E) => {
  async function N() {
    const { nodeLookup: _, panZoom: C, fitViewOptions: D, fitViewResolver: M, width: R, height: Q, minZoom: V, maxZoom: k } = E();
    C && (await vA({
      nodes: _,
      width: R,
      height: Q,
      panZoom: C,
      minZoom: V,
      maxZoom: k
    }, D), M?.resolve(!0), w({ fitViewResolver: null }));
  }
  return {
    ...k1({
      nodes: n,
      edges: a,
      width: o,
      height: f,
      fitView: h,
      fitViewOptions: m,
      minZoom: v,
      maxZoom: y,
      nodeOrigin: g,
      nodeExtent: p,
      defaultNodes: s,
      defaultEdges: r,
      zIndexMode: S
    }),
    setNodes: (_) => {
      const { nodeLookup: C, parentLookup: D, nodeOrigin: M, nodeExtent: R, elevateNodesOnSelect: Q, fitViewQueued: V, zIndexMode: k, nodesSelectionActive: H } = E(), { nodesInitialized: q, hasSelectedNodes: de } = xp(_, C, D, {
        nodeOrigin: M,
        nodeExtent: R,
        elevateNodesOnSelect: Q,
        checkEquality: !0,
        zIndexMode: k
      }), ee = H && de;
      V && q ? (N(), w({
        nodes: _,
        nodesInitialized: q,
        fitViewQueued: !1,
        fitViewOptions: void 0,
        nodesSelectionActive: ee
      })) : w({ nodes: _, nodesInitialized: q, nodesSelectionActive: ee });
    },
    setEdges: (_) => {
      const { connectionLookup: C, edgeLookup: D } = E();
      TS(C, D, _), w({ edges: _ });
    },
    setDefaultNodesAndEdges: (_, C) => {
      if (_) {
        const { setNodes: D } = E();
        D(_), w({ hasDefaultNodes: !0 });
      }
      if (C) {
        const { setEdges: D } = E();
        D(C), w({ hasDefaultEdges: !0 });
      }
    },
    /*
     * Every node gets registered at a ResizeObserver. Whenever a node
     * changes its dimensions, this function is called to measure the
     * new dimensions and update the nodes.
     */
    updateNodeInternals: (_) => {
      const { triggerNodeChanges: C, nodeLookup: D, parentLookup: M, domNode: R, nodeOrigin: Q, nodeExtent: V, debug: k, fitViewQueued: H, zIndexMode: q } = E(), { changes: de, updatedInternals: ee } = VA(_, D, M, R, Q, V, q);
      ee && (UA(D, M, { nodeOrigin: Q, nodeExtent: V, zIndexMode: q }), H ? (N(), w({ fitViewQueued: !1, fitViewOptions: void 0 })) : w({}), de?.length > 0 && (k && console.log("React Flow: trigger node changes", de), C?.(de)));
    },
    updateNodePositions: (_, C = !1) => {
      const D = [];
      let M = [];
      const { nodeLookup: R, triggerNodeChanges: Q, connection: V, updateConnection: k, onNodesChangeMiddlewareMap: H } = E();
      for (const [q, de] of _) {
        const ee = R.get(q), me = !!(ee?.expandParent && ee?.parentId && de?.position), te = {
          id: q,
          type: "position",
          position: me ? {
            x: Math.max(0, de.position.x),
            y: Math.max(0, de.position.y)
          } : de.position,
          dragging: C
        };
        if (ee && V.inProgress && V.fromNode.id === ee.id) {
          const O = ir(ee, V.fromHandle, Ue.Left, !0);
          k({ ...V, from: O });
        }
        me && ee.parentId && D.push({
          id: q,
          parentId: ee.parentId,
          rect: {
            ...de.internals.positionAbsolute,
            width: de.measured.width ?? 0,
            height: de.measured.height ?? 0
          }
        }), M.push(te);
      }
      if (D.length > 0) {
        const { parentLookup: q, nodeOrigin: de } = E(), ee = Jp(D, R, q, de);
        M.push(...ee);
      }
      for (const q of H.values())
        M = q(M);
      Q(M);
    },
    triggerNodeChanges: (_) => {
      const { onNodesChange: C, setNodes: D, nodes: M, hasDefaultNodes: R, debug: Q } = E();
      if (_?.length) {
        if (R) {
          const V = GM(_, M);
          D(V);
        }
        Q && console.log("React Flow: trigger node changes", _), C?.(_);
      }
    },
    triggerEdgeChanges: (_) => {
      const { onEdgesChange: C, setEdges: D, edges: M, hasDefaultEdges: R, debug: Q } = E();
      if (_?.length) {
        if (R) {
          const V = ZM(_, M);
          D(V);
        }
        Q && console.log("React Flow: trigger edge changes", _), C?.(_);
      }
    },
    addSelectedNodes: (_) => {
      const { multiSelectionActive: C, edgeLookup: D, nodeLookup: M, triggerNodeChanges: R, triggerEdgeChanges: Q } = E();
      if (C) {
        const V = _.map((k) => Ys(k, !0));
        R(V);
        return;
      }
      R(Fr(M, /* @__PURE__ */ new Set([..._]))), Q(Fr(D));
    },
    addSelectedEdges: (_) => {
      const { multiSelectionActive: C, edgeLookup: D, nodeLookup: M, triggerNodeChanges: R, triggerEdgeChanges: Q } = E();
      if (C) {
        const V = _.map((k) => Ys(k, !0));
        Q(V);
        return;
      }
      Q(Fr(D, /* @__PURE__ */ new Set([..._]))), R(Fr(M, /* @__PURE__ */ new Set()));
    },
    unselectNodesAndEdges: ({ nodes: _, edges: C } = {}) => {
      const { edges: D, nodes: M, nodeLookup: R, triggerNodeChanges: Q, triggerEdgeChanges: V } = E(), k = _ || M, H = C || D, q = [];
      for (const ee of k)
        ee.selected && q.push(Ys(ee.id, !1));
      const de = [];
      for (const ee of H)
        ee.selected && de.push(Ys(ee.id, !1));
      Q(q), V(de);
    },
    setMinZoom: (_) => {
      const { panZoom: C, maxZoom: D } = E();
      C?.setScaleExtent([_, D]), w({ minZoom: _ });
    },
    setMaxZoom: (_) => {
      const { panZoom: C, minZoom: D } = E();
      C?.setScaleExtent([D, _]), w({ maxZoom: _ });
    },
    setTranslateExtent: (_) => {
      E().panZoom?.setTranslateExtent(_), w({ translateExtent: _ });
    },
    resetSelectedElements: () => {
      const { edges: _, nodes: C, triggerNodeChanges: D, triggerEdgeChanges: M, elementsSelectable: R } = E();
      if (!R)
        return;
      const Q = C.reduce((k, H) => H.selected ? [...k, Ys(H.id, !1)] : k, []), V = _.reduce((k, H) => H.selected ? [...k, Ys(H.id, !1)] : k, []);
      D(Q), M(V);
    },
    setNodeExtent: (_) => {
      const { nodes: C, nodeLookup: D, parentLookup: M, nodeOrigin: R, elevateNodesOnSelect: Q, nodeExtent: V, zIndexMode: k } = E();
      _[0][0] === V[0][0] && _[0][1] === V[0][1] && _[1][0] === V[1][0] && _[1][1] === V[1][1] || (xp(C, D, M, {
        nodeOrigin: R,
        nodeExtent: _,
        elevateNodesOnSelect: Q,
        checkEquality: !1,
        zIndexMode: k
      }), w({ nodeExtent: _ }));
    },
    panBy: (_) => {
      const { transform: C, width: D, height: M, panZoom: R, translateExtent: Q } = E();
      return YA({ delta: _, panZoom: R, transform: C, translateExtent: Q, width: D, height: M });
    },
    setCenter: async (_, C, D) => {
      const { width: M, height: R, maxZoom: Q, panZoom: V } = E();
      if (!V)
        return !1;
      const k = typeof D?.zoom < "u" ? D.zoom : Q;
      return await V.setViewport({
        x: M / 2 - _ * k,
        y: R / 2 - C * k,
        zoom: k
      }, { duration: D?.duration, ease: D?.ease, interpolate: D?.interpolate }), !0;
    },
    cancelConnection: () => {
      w({
        connection: { ...rS }
      });
    },
    updateConnection: (_) => {
      w({ connection: _ });
    },
    reset: () => w({ ...k1() })
  };
}, Object.is);
function hw({ initialNodes: n, initialEdges: a, defaultNodes: s, defaultEdges: r, initialWidth: o, initialHeight: f, initialMinZoom: h, initialMaxZoom: m, initialFitViewOptions: v, fitView: y, nodeOrigin: g, nodeExtent: p, zIndexMode: S, children: w }) {
  const [E] = A.useState(() => hk({
    nodes: n,
    edges: a,
    defaultNodes: s,
    defaultEdges: r,
    width: o,
    height: f,
    fitView: y,
    minZoom: h,
    maxZoom: m,
    fitViewOptions: v,
    nodeOrigin: g,
    nodeExtent: p,
    zIndexMode: S
  }));
  return d.jsx(TM, { value: E, children: d.jsx(FM, { children: d.jsx(hz, { children: w }) }) });
}
function mk({ children: n, nodes: a, edges: s, defaultNodes: r, defaultEdges: o, width: f, height: h, fitView: m, fitViewOptions: v, minZoom: y, maxZoom: g, nodeOrigin: p, nodeExtent: S, zIndexMode: w }) {
  return A.useContext(td) ? d.jsx(d.Fragment, { children: n }) : d.jsx(hw, { initialNodes: a, initialEdges: s, defaultNodes: r, defaultEdges: o, initialWidth: f, initialHeight: h, fitView: m, initialFitViewOptions: v, initialMinZoom: y, initialMaxZoom: g, nodeOrigin: p, nodeExtent: S, zIndexMode: w, children: n });
}
const pk = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
  position: "relative",
  zIndex: 0
};
function gk({ nodes: n, edges: a, defaultNodes: s, defaultEdges: r, className: o, nodeTypes: f, edgeTypes: h, onNodeClick: m, onEdgeClick: v, onInit: y, onMove: g, onMoveStart: p, onMoveEnd: S, onConnect: w, onConnectStart: E, onConnectEnd: N, onClickConnectStart: _, onClickConnectEnd: C, onNodeMouseEnter: D, onNodeMouseMove: M, onNodeMouseLeave: R, onNodeContextMenu: Q, onNodeDoubleClick: V, onNodeDragStart: k, onNodeDrag: H, onNodeDragStop: q, onNodesDelete: de, onEdgesDelete: ee, onDelete: me, onSelectionChange: te, onSelectionDragStart: O, onSelectionDrag: Y, onSelectionDragStop: j, onSelectionContextMenu: B, onSelectionStart: X, onSelectionEnd: J, onBeforeDelete: I, connectionMode: ae, connectionLineType: he = ps.Bezier, connectionLineStyle: Ee, connectionLineComponent: L, connectionLineContainerStyle: ce, deleteKeyCode: pe = "Backspace", selectionKeyCode: Se = "Shift", selectionOnDrag: le = !1, selectionMode: Te = fo.Full, panActivationKeyCode: Ce = "Space", multiSelectionKeyCode: we = Oc() ? "Meta" : "Control", zoomActivationKeyCode: Ne = Oc() ? "Meta" : "Control", snapToGrid: ze, snapGrid: Ve, onlyRenderVisibleElements: $e = !1, selectNodesOnDrag: Me, nodesDraggable: Ge, autoPanOnNodeFocus: Re, nodesConnectable: _t, nodesFocusable: it, nodeOrigin: At = BS, edgesFocusable: Mn, edgesReconnectable: Et, elementsSelectable: sn = !0, defaultViewport: It = BM, minZoom: bt = 0.5, maxZoom: Nt = 2, translateExtent: St = jc, preventScrolling: ft = !0, nodeExtent: Bt, defaultMarkerColor: gn = "#b1b1b7", zoomOnScroll: $t = !0, zoomOnPinch: Qn = !0, panOnScroll: fn = !1, panOnScrollSpeed: Gt = 0.5, panOnScrollMode: yn = Js.Free, zoomOnDoubleClick: Wt = !0, panOnDrag: Li = !0, onPaneClick: Zt, onPaneMouseEnter: Tt, onPaneMouseMove: vn, onPaneMouseLeave: dn, onPaneScroll: Lt, onPaneContextMenu: zn, paneClickDistance: Fe = 1, nodeClickDistance: qa = 0, children: xn, onReconnect: dt, onReconnectStart: en, onReconnectEnd: hn, onEdgeContextMenu: Mt, onEdgeDoubleClick: ri, onEdgeMouseEnter: rn, onEdgeMouseMove: oe, onEdgeMouseLeave: ke, reconnectRadius: Ye = 10, onNodesChange: K, onEdgesChange: at, noDragClassName: Kn = "nodrag", noWheelClassName: Qt = "nowheel", noPanClassName: tn = "nopan", fitView: dl, fitViewOptions: Ln, connectOnClick: Va, attributionPosition: nn, proOptions: Ot, defaultEdgeOptions: gi, elevateNodesOnSelect: Ya = !0, elevateEdgesOnSelect: rt = !1, disableKeyboardA11y: Ui = !1, autoPanOnConnect: ht, autoPanOnNodeDrag: kn, autoPanOnSelection: ea = !0, autoPanSpeed: oi, connectionRadius: qt, isValidConnection: bn, onError: Pe, style: ga, id: zt, nodeDragThreshold: ta, connectionDragThreshold: na, viewport: Bi, onViewportChange: ia, width: aa, height: _i, colorMode: Ei = "light", debug: $i, onScroll: jn, ariaLabelConfig: yt, zIndexMode: ci = "basic", ...la }, Ia) {
  const ui = zt || "1", Ni = YM(Ei), Xa = A.useCallback((ya) => {
    ya.currentTarget.scrollTo({ top: 0, left: 0, behavior: "instant" }), jn?.(ya);
  }, [jn]);
  return d.jsx("div", { "data-testid": "rf__wrapper", ...la, onScroll: Xa, style: { ...ga, ...pk }, ref: Ia, className: An(["react-flow", o, Ni]), id: zt, role: "application", children: d.jsxs(mk, { nodes: n, edges: a, width: aa, height: _i, fitView: dl, fitViewOptions: Ln, minZoom: bt, maxZoom: Nt, nodeOrigin: At, nodeExtent: Bt, zIndexMode: ci, children: [d.jsx(VM, { nodes: n, edges: a, defaultNodes: s, defaultEdges: r, onConnect: w, onConnectStart: E, onConnectEnd: N, onClickConnectStart: _, onClickConnectEnd: C, nodesDraggable: Ge, autoPanOnNodeFocus: Re, nodesConnectable: _t, nodesFocusable: it, edgesFocusable: Mn, edgesReconnectable: Et, elementsSelectable: sn, elevateNodesOnSelect: Ya, elevateEdgesOnSelect: rt, minZoom: bt, maxZoom: Nt, nodeExtent: Bt, onNodesChange: K, onEdgesChange: at, snapToGrid: ze, snapGrid: Ve, connectionMode: ae, translateExtent: St, connectOnClick: Va, defaultEdgeOptions: gi, fitView: dl, fitViewOptions: Ln, onNodesDelete: de, onEdgesDelete: ee, onDelete: me, onNodeDragStart: k, onNodeDrag: H, onNodeDragStop: q, onSelectionDrag: Y, onSelectionDragStart: O, onSelectionDragStop: j, onMove: g, onMoveStart: p, onMoveEnd: S, noPanClassName: tn, nodeOrigin: At, rfId: ui, autoPanOnConnect: ht, autoPanOnNodeDrag: kn, autoPanSpeed: oi, onError: Pe, connectionRadius: qt, isValidConnection: bn, selectNodesOnDrag: Me, nodeDragThreshold: ta, connectionDragThreshold: na, onBeforeDelete: I, debug: $i, ariaLabelConfig: yt, zIndexMode: ci }), d.jsx(fk, { onInit: y, onNodeClick: m, onEdgeClick: v, onNodeMouseEnter: D, onNodeMouseMove: M, onNodeMouseLeave: R, onNodeContextMenu: Q, onNodeDoubleClick: V, nodeTypes: f, edgeTypes: h, connectionLineType: he, connectionLineStyle: Ee, connectionLineComponent: L, connectionLineContainerStyle: ce, selectionKeyCode: Se, selectionOnDrag: le, selectionMode: Te, deleteKeyCode: pe, multiSelectionKeyCode: we, panActivationKeyCode: Ce, zoomActivationKeyCode: Ne, onlyRenderVisibleElements: $e, defaultViewport: It, translateExtent: St, minZoom: bt, maxZoom: Nt, preventScrolling: ft, zoomOnScroll: $t, zoomOnPinch: Qn, zoomOnDoubleClick: Wt, panOnScroll: fn, panOnScrollSpeed: Gt, panOnScrollMode: yn, panOnDrag: Li, autoPanOnSelection: ea, onPaneClick: Zt, onPaneMouseEnter: Tt, onPaneMouseMove: vn, onPaneMouseLeave: dn, onPaneScroll: Lt, onPaneContextMenu: zn, paneClickDistance: Fe, nodeClickDistance: qa, onSelectionContextMenu: B, onSelectionStart: X, onSelectionEnd: J, onReconnect: dt, onReconnectStart: en, onReconnectEnd: hn, onEdgeContextMenu: Mt, onEdgeDoubleClick: ri, onEdgeMouseEnter: rn, onEdgeMouseMove: oe, onEdgeMouseLeave: ke, reconnectRadius: Ye, defaultMarkerColor: gn, noDragClassName: Kn, noWheelClassName: Qt, noPanClassName: tn, rfId: ui, disableKeyboardA11y: Ui, nodeExtent: Bt, viewport: Bi, onViewportChange: ia, nodesDraggable: Ge }), d.jsx(UM, { onSelectionChange: te }), xn, d.jsx(RM, { proOptions: Ot, position: nn }), d.jsx(jM, { rfId: ui, disableKeyboardA11y: Ui })] }) });
}
var yk = qS(gk);
const vk = (n) => ({
  x: n.transform[0],
  y: n.transform[1],
  zoom: n.transform[2]
});
function xk() {
  return gt(vk, Jt);
}
function bk({ dimensions: n, lineWidth: a, variant: s, className: r }) {
  return d.jsx("path", { strokeWidth: a, d: `M${n[0] / 2} 0 V${n[1]} M0 ${n[1] / 2} H${n[0]}`, className: An(["react-flow__background-pattern", s, r]) });
}
function Sk({ radius: n, className: a }) {
  return d.jsx("circle", { cx: n, cy: n, r: n, className: An(["react-flow__background-pattern", "dots", a]) });
}
var gs;
(function(n) {
  n.Lines = "lines", n.Dots = "dots", n.Cross = "cross";
})(gs || (gs = {}));
const wk = {
  [gs.Dots]: 1,
  [gs.Lines]: 1,
  [gs.Cross]: 6
}, _k = (n) => ({ transform: n.transform, patternId: `pattern-${n.rfId}` });
function mw({
  id: n,
  variant: a = gs.Dots,
  // only used for dots and cross
  gap: s = 20,
  // only used for lines and cross
  size: r,
  lineWidth: o = 1,
  offset: f = 0,
  color: h,
  bgColor: m,
  style: v,
  className: y,
  patternClassName: g
}) {
  const p = A.useRef(null), { transform: S, patternId: w } = gt(_k, Jt), E = r || wk[a], N = a === gs.Dots, _ = a === gs.Cross, C = Array.isArray(s) ? s : [s, s], D = [C[0] * S[2] || 1, C[1] * S[2] || 1], M = E * S[2], R = Array.isArray(f) ? f : [f, f], Q = _ ? [M, M] : D, V = [
    R[0] * S[2] + Q[0] / 2,
    R[1] * S[2] + Q[1] / 2
  ], k = `${w}${n || ""}`;
  return d.jsxs("svg", { className: An(["react-flow__background", y]), style: {
    ...v,
    ...ad,
    "--xy-background-color-props": m,
    "--xy-background-pattern-color-props": h
  }, ref: p, "data-testid": "rf__background", children: [d.jsx("pattern", { id: k, x: S[0] % D[0], y: S[1] % D[1], width: D[0], height: D[1], patternUnits: "userSpaceOnUse", patternTransform: `translate(-${V[0]},-${V[1]})`, children: N ? d.jsx(Sk, { radius: M / 2, className: g }) : d.jsx(bk, { dimensions: Q, lineWidth: o, variant: a, className: g }) }), d.jsx("rect", { x: "0", y: "0", width: "100%", height: "100%", fill: `url(#${k})` })] });
}
mw.displayName = "Background";
A.memo(mw);
function Ek() {
  return d.jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 32 32", children: d.jsx("path", { d: "M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" }) });
}
function Nk() {
  return d.jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 32 5", children: d.jsx("path", { d: "M0 0h32v4.2H0z" }) });
}
function Tk() {
  return d.jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 32 30", children: d.jsx("path", { d: "M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" }) });
}
function Ck() {
  return d.jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 25 32", children: d.jsx("path", { d: "M21.333 10.667H19.81V7.619C19.81 3.429 16.38 0 12.19 0 8 0 4.571 3.429 4.571 7.619v3.048H3.048A3.056 3.056 0 000 13.714v15.238A3.056 3.056 0 003.048 32h18.285a3.056 3.056 0 003.048-3.048V13.714a3.056 3.056 0 00-3.048-3.047zM12.19 24.533a3.056 3.056 0 01-3.047-3.047 3.056 3.056 0 013.047-3.048 3.056 3.056 0 013.048 3.048 3.056 3.056 0 01-3.048 3.047zm4.724-13.866H7.467V7.619c0-2.59 2.133-4.724 4.723-4.724 2.591 0 4.724 2.133 4.724 4.724v3.048z" }) });
}
function Ak() {
  return d.jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 25 32", children: d.jsx("path", { d: "M21.333 10.667H19.81V7.619C19.81 3.429 16.38 0 12.19 0c-4.114 1.828-1.37 2.133.305 2.438 1.676.305 4.42 2.59 4.42 5.181v3.048H3.047A3.056 3.056 0 000 13.714v15.238A3.056 3.056 0 003.048 32h18.285a3.056 3.056 0 003.048-3.048V13.714a3.056 3.056 0 00-3.048-3.047zM12.19 24.533a3.056 3.056 0 01-3.047-3.047 3.056 3.056 0 013.047-3.048 3.056 3.056 0 013.048 3.048 3.056 3.056 0 01-3.048 3.047z" }) });
}
function mf({ children: n, className: a, ...s }) {
  return d.jsx("button", { type: "button", className: An(["react-flow__controls-button", a]), ...s, children: n });
}
const Mk = (n) => ({
  isInteractive: n.nodesDraggable || n.nodesConnectable || n.elementsSelectable,
  minZoomReached: n.transform[2] <= n.minZoom,
  maxZoomReached: n.transform[2] >= n.maxZoom,
  ariaLabelConfig: n.ariaLabelConfig
});
function pw({ style: n, showZoom: a = !0, showFitView: s = !0, showInteractive: r = !0, fitViewOptions: o, onZoomIn: f, onZoomOut: h, onFitView: m, onInteractiveChange: v, className: y, children: g, position: p = "bottom-left", orientation: S = "vertical", "aria-label": w }) {
  const E = Xt(), { isInteractive: N, minZoomReached: _, maxZoomReached: C, ariaLabelConfig: D } = gt(Mk, Jt), { zoomIn: M, zoomOut: R, fitView: Q } = id(), V = () => {
    M(), f?.();
  }, k = () => {
    R(), h?.();
  }, H = () => {
    Q(o), m?.();
  }, q = () => {
    E.setState({
      nodesDraggable: !N,
      nodesConnectable: !N,
      elementsSelectable: !N
    }), v?.(!N);
  }, de = S === "horizontal" ? "horizontal" : "vertical";
  return d.jsxs(nd, { className: An(["react-flow__controls", de, y]), position: p, style: n, "data-testid": "rf__controls", "aria-label": w ?? D["controls.ariaLabel"], children: [a && d.jsxs(d.Fragment, { children: [d.jsx(mf, { onClick: V, className: "react-flow__controls-zoomin", title: D["controls.zoomIn.ariaLabel"], "aria-label": D["controls.zoomIn.ariaLabel"], disabled: C, children: d.jsx(Ek, {}) }), d.jsx(mf, { onClick: k, className: "react-flow__controls-zoomout", title: D["controls.zoomOut.ariaLabel"], "aria-label": D["controls.zoomOut.ariaLabel"], disabled: _, children: d.jsx(Nk, {}) })] }), s && d.jsx(mf, { className: "react-flow__controls-fitview", onClick: H, title: D["controls.fitView.ariaLabel"], "aria-label": D["controls.fitView.ariaLabel"], children: d.jsx(Tk, {}) }), r && d.jsx(mf, { className: "react-flow__controls-interactive", onClick: q, title: D["controls.interactive.ariaLabel"], "aria-label": D["controls.interactive.ariaLabel"], children: N ? d.jsx(Ak, {}) : d.jsx(Ck, {}) }), g] });
}
pw.displayName = "Controls";
A.memo(pw);
function zk({ id: n, x: a, y: s, width: r, height: o, style: f, color: h, strokeColor: m, strokeWidth: v, className: y, borderRadius: g, shapeRendering: p, selected: S, onClick: w }) {
  const { background: E, backgroundColor: N } = f || {}, _ = h || E || N;
  return d.jsx("rect", { className: An(["react-flow__minimap-node", { selected: S }, y]), x: a, y: s, rx: g, ry: g, width: r, height: o, style: {
    fill: _,
    stroke: m,
    strokeWidth: v
  }, shapeRendering: p, onClick: w ? (C) => w(C, n) : void 0 });
}
const kk = A.memo(zk), jk = (n) => n.nodes.map((a) => a.id), Ym = (n) => n instanceof Function ? n : () => n;
function Rk({
  nodeStrokeColor: n,
  nodeColor: a,
  nodeClassName: s = "",
  nodeBorderRadius: r = 5,
  nodeStrokeWidth: o,
  /*
   * We need to rename the prop to be `CapitalCase` so that JSX will render it as
   * a component properly.
   */
  nodeComponent: f = kk,
  onClick: h
}) {
  const m = gt(jk, Jt), v = Ym(a), y = Ym(n), g = Ym(s), p = typeof window > "u" || window.chrome ? "crispEdges" : "geometricPrecision";
  return d.jsx(d.Fragment, { children: m.map((S) => (
    /*
     * The split of responsibilities between MiniMapNodes and
     * NodeComponentWrapper may appear weird. However, it’s designed to
     * minimize the cost of updates when individual nodes change.
     *
     * For more details, see a similar commit in `NodeRenderer/index.tsx`.
     */
    d.jsx(Dk, { id: S, nodeColorFunc: v, nodeStrokeColorFunc: y, nodeClassNameFunc: g, nodeBorderRadius: r, nodeStrokeWidth: o, NodeComponent: f, onClick: h, shapeRendering: p }, S)
  )) });
}
function Ok({ id: n, nodeColorFunc: a, nodeStrokeColorFunc: s, nodeClassNameFunc: r, nodeBorderRadius: o, nodeStrokeWidth: f, shapeRendering: h, NodeComponent: m, onClick: v }) {
  const { node: y, x: g, y: p, width: S, height: w } = gt((E) => {
    const N = E.nodeLookup.get(n);
    if (!N)
      return { node: void 0, x: 0, y: 0, width: 0, height: 0 };
    const _ = N.internals.userNode, { x: C, y: D } = N.internals.positionAbsolute, { width: M, height: R } = $a(_);
    return {
      node: _,
      x: C,
      y: D,
      width: M,
      height: R
    };
  }, Jt);
  return !y || y.hidden || !mS(y) ? null : d.jsx(m, { x: g, y: p, width: S, height: w, style: y.style, selected: !!y.selected, className: r(y), color: a(y), borderRadius: o, strokeColor: s(y), strokeWidth: f, shapeRendering: h, onClick: v, id: y.id });
}
const Dk = A.memo(Ok);
var Hk = A.memo(Rk);
const Lk = 200, Uk = 150, Bk = (n) => !n.hidden, $k = (n) => {
  const a = {
    x: -n.transform[0] / n.transform[2],
    y: -n.transform[1] / n.transform[2],
    width: n.width / n.transform[2],
    height: n.height / n.transform[2]
  };
  let s = !1;
  for (const r of n.nodeLookup.values())
    if (!r.hidden) {
      s = !0;
      break;
    }
  return {
    viewBB: a,
    boundingRect: s ? fS($c(n.nodeLookup, { filter: Bk }), a) : a,
    rfId: n.rfId,
    panZoom: n.panZoom,
    translateExtent: n.translateExtent,
    flowWidth: n.width,
    flowHeight: n.height,
    ariaLabelConfig: n.ariaLabelConfig
  };
}, j1 = (n, a) => n.x === a.x && n.y === a.y && n.width === a.width && n.height === a.height, qk = (n, a) => j1(n.viewBB, a.viewBB) && j1(n.boundingRect, a.boundingRect) && n.rfId === a.rfId && n.panZoom === a.panZoom && n.translateExtent === a.translateExtent && n.flowWidth === a.flowWidth && n.flowHeight === a.flowHeight && n.ariaLabelConfig === a.ariaLabelConfig, Vk = "react-flow__minimap-desc";
function gw({
  style: n,
  className: a,
  nodeStrokeColor: s,
  nodeColor: r,
  nodeClassName: o = "",
  nodeBorderRadius: f = 5,
  nodeStrokeWidth: h,
  /*
   * We need to rename the prop to be `CapitalCase` so that JSX will render it as
   * a component properly.
   */
  nodeComponent: m,
  bgColor: v,
  maskColor: y,
  maskStrokeColor: g,
  maskStrokeWidth: p,
  position: S = "bottom-right",
  onClick: w,
  onNodeClick: E,
  pannable: N = !1,
  zoomable: _ = !1,
  ariaLabel: C,
  inversePan: D,
  zoomStep: M = 1,
  offsetScale: R = 5
}) {
  const Q = Xt(), V = A.useRef(null), { boundingRect: k, panZoom: H, viewBB: q, rfId: de, translateExtent: ee, flowWidth: me, flowHeight: te, ariaLabelConfig: O } = gt($k, qk), Y = n?.width ?? Lk, j = n?.height ?? Uk, B = k.width / Y, X = k.height / j, J = Math.max(B, X), I = J * Y, ae = J * j, he = R * J, Ee = k.x - (I - k.width) / 2 - he, L = k.y - (ae - k.height) / 2 - he, ce = I + he * 2, pe = ae + he * 2, Se = `${Vk}-${de}`, le = A.useRef(0), Te = A.useRef();
  le.current = J, A.useEffect(() => {
    const Ve = Q.getState().panZoom;
    if (V.current && Ve)
      return Te.current = FA({
        domNode: V.current,
        panZoom: Ve,
        getTransform: () => Q.getState().transform,
        getViewScale: () => le.current
      }), () => {
        Te.current?.destroy();
      };
  }, [H]), A.useEffect(() => {
    Te.current?.update({
      translateExtent: ee,
      width: me,
      height: te,
      inversePan: D,
      pannable: N,
      zoomStep: M,
      zoomable: _
    });
  }, [N, _, D, M, ee, me, te]);
  const Ce = w ? (Ve) => {
    const [$e, Me] = Te.current?.pointer(Ve) || [0, 0];
    w(Ve, { x: $e, y: Me });
  } : void 0, we = A.useCallback((Ve, $e) => {
    const Me = Q.getState().nodeLookup.get($e).internals.userNode;
    E?.(Ve, Me);
  }, [E]), Ne = E ? we : void 0, ze = C ?? O["minimap.ariaLabel"];
  return d.jsx(nd, { position: S, style: {
    ...n,
    "--xy-minimap-background-color-props": typeof v == "string" ? v : void 0,
    "--xy-minimap-mask-background-color-props": typeof y == "string" ? y : void 0,
    "--xy-minimap-mask-stroke-color-props": typeof g == "string" ? g : void 0,
    "--xy-minimap-mask-stroke-width-props": typeof p == "number" ? p * J : void 0,
    "--xy-minimap-node-background-color-props": typeof r == "string" ? r : void 0,
    "--xy-minimap-node-stroke-color-props": typeof s == "string" ? s : void 0,
    "--xy-minimap-node-stroke-width-props": typeof h == "number" ? h : void 0
  }, className: An(["react-flow__minimap", a]), "data-testid": "rf__minimap", children: d.jsxs("svg", { width: Y, height: j, viewBox: `${Ee} ${L} ${ce} ${pe}`, className: "react-flow__minimap-svg", role: "img", "aria-labelledby": Se, ref: V, onClick: Ce, children: [ze && d.jsx("title", { id: Se, children: ze }), d.jsx(Hk, { onClick: Ne, nodeColor: r, nodeStrokeColor: s, nodeBorderRadius: f, nodeClassName: o, nodeStrokeWidth: h, nodeComponent: m }), d.jsx("path", { className: "react-flow__minimap-mask", d: `M${Ee - he},${L - he}h${ce + he * 2}v${pe + he * 2}h${-ce - he * 2}z
        M${q.x},${q.y}h${q.width}v${q.height}h${-q.width}z`, fillRule: "evenodd", pointerEvents: "none" })] }) });
}
gw.displayName = "MiniMap";
const Yk = A.memo(gw), Ik = (n) => (a) => n ? `${Math.max(1 / a.transform[2], 1)}` : void 0, Xk = {
  [ar.Line]: "right",
  [ar.Handle]: "bottom-right"
};
function Gk({ nodeId: n, position: a, variant: s = ar.Handle, className: r, style: o = void 0, children: f, color: h, minWidth: m = 10, minHeight: v = 10, maxWidth: y = Number.MAX_VALUE, maxHeight: g = Number.MAX_VALUE, keepAspectRatio: p = !1, resizeDirection: S, autoScale: w = !0, shouldResize: E, onResizeStart: N, onResize: _, onResizeEnd: C }) {
  const D = GS(), M = typeof n == "string" ? n : D, R = Xt(), Q = A.useRef(null), V = s === ar.Handle, k = gt(A.useCallback(Ik(V && w), [V, w]), Jt), H = A.useRef(null), q = a ?? Xk[s];
  A.useEffect(() => {
    if (!(!Q.current || !M))
      return H.current || (H.current = hM({
        domNode: Q.current,
        nodeId: M,
        getStoreItems: () => {
          const { nodeLookup: ee, transform: me, snapGrid: te, snapToGrid: O, nodeOrigin: Y, domNode: j } = R.getState();
          return {
            nodeLookup: ee,
            transform: me,
            snapGrid: te,
            snapToGrid: O,
            nodeOrigin: Y,
            paneDomNode: j
          };
        },
        onChange: (ee, me) => {
          const { triggerNodeChanges: te, nodeLookup: O, parentLookup: Y, nodeOrigin: j } = R.getState(), B = [], X = { x: ee.x, y: ee.y }, J = O.get(M);
          if (J && J.expandParent && J.parentId) {
            const I = J.origin ?? j, ae = ee.width ?? J.measured.width ?? 0, he = ee.height ?? J.measured.height ?? 0, Ee = {
              id: J.id,
              parentId: J.parentId,
              rect: {
                width: ae,
                height: he,
                ...pS({
                  x: ee.x ?? J.position.x,
                  y: ee.y ?? J.position.y
                }, { width: ae, height: he }, J.parentId, O, I)
              }
            }, L = Jp([Ee], O, Y, j);
            B.push(...L), X.x = ee.x ? Math.max(I[0] * ae, ee.x) : void 0, X.y = ee.y ? Math.max(I[1] * he, ee.y) : void 0;
          }
          if (X.x !== void 0 && X.y !== void 0) {
            const I = {
              id: M,
              type: "position",
              position: { ...X }
            };
            B.push(I);
          }
          if (ee.width !== void 0 && ee.height !== void 0) {
            const ae = {
              id: M,
              type: "dimensions",
              resizing: !0,
              setAttributes: S ? S === "horizontal" ? "width" : "height" : !0,
              dimensions: {
                width: ee.width,
                height: ee.height
              }
            };
            B.push(ae);
          }
          for (const I of me) {
            const ae = {
              ...I,
              type: "position"
            };
            B.push(ae);
          }
          te(B);
        },
        onEnd: ({ width: ee, height: me }) => {
          const te = {
            id: M,
            type: "dimensions",
            resizing: !1,
            dimensions: {
              width: ee,
              height: me
            }
          };
          R.getState().triggerNodeChanges([te]);
        }
      })), H.current.update({
        controlPosition: q,
        boundaries: {
          minWidth: m,
          minHeight: v,
          maxWidth: y,
          maxHeight: g
        },
        keepAspectRatio: p,
        resizeDirection: S,
        onResizeStart: N,
        onResize: _,
        onResizeEnd: C,
        shouldResize: E
      }), () => {
        H.current?.destroy();
      };
  }, [
    q,
    m,
    v,
    y,
    g,
    p,
    N,
    _,
    C,
    E
  ]);
  const de = q.split("-");
  return d.jsx("div", { className: An(["react-flow__resize-control", "nodrag", ...de, s, r]), ref: Q, style: {
    ...o,
    scale: k,
    ...h && { [V ? "backgroundColor" : "borderColor"]: h }
  }, children: f });
}
const R1 = A.memo(Gk);
function Zk({ nodeId: n, isVisible: a = !0, handleClassName: s, handleStyle: r, lineClassName: o, lineStyle: f, color: h, minWidth: m = 10, minHeight: v = 10, maxWidth: y = Number.MAX_VALUE, maxHeight: g = Number.MAX_VALUE, keepAspectRatio: p = !1, autoScale: S = !0, shouldResize: w, onResizeStart: E, onResize: N, onResizeEnd: _ }) {
  return a ? d.jsxs(d.Fragment, { children: [oM.map((C) => d.jsx(R1, { className: o, style: f, nodeId: n, position: C, variant: ar.Line, color: h, minWidth: m, minHeight: v, maxWidth: y, maxHeight: g, onResizeStart: E, keepAspectRatio: p, autoScale: S, shouldResize: w, onResize: N, onResizeEnd: _ }, C)), rM.map((C) => d.jsx(R1, { className: s, style: r, nodeId: n, position: C, color: h, minWidth: m, minHeight: v, maxWidth: y, maxHeight: g, onResizeStart: E, keepAspectRatio: p, autoScale: S, shouldResize: w, onResize: N, onResizeEnd: _ }, C))] }) : null;
}
const uc = (n) => structuredClone(n);
function Qk(n, a) {
  const [s] = A.useState(() => {
    let j = sessionStorage.getItem("fm-canvas-editor");
    return j || (j = crypto.randomUUID(), sessionStorage.setItem("fm-canvas-editor", j)), j;
  }), r = `fm-canvas-${a}-${n.id}-${s}`, o = A.useRef(null);
  if (!o.current) {
    let j = { title: n.title, document: n.document }, B = !1, X = !1;
    try {
      const J = JSON.parse(localStorage.getItem(r) || "null");
      J?.draft && J.draft.document.schemaVersion === 1 && JSON.stringify(J.draft) !== JSON.stringify(j) && (j = J.draft, X = !0, B = J.revision !== n.revision);
    } catch {
    }
    o.current = { draft: j, conflict: B, dirty: X };
  }
  const [f, h] = A.useState(o.current.draft), m = A.useRef(f), v = A.useRef(n.revision), y = A.useRef(o.current.dirty ? 1 : 0), g = A.useRef(0), [p, S] = A.useState(
    o.current.conflict ? "conflict" : o.current.dirty ? "dirty" : "saved"
  ), w = A.useRef(o.current.conflict), E = A.useRef(null), N = A.useRef(null), _ = A.useRef([]), C = A.useRef([]), [D, M] = A.useState(0), [R, Q] = A.useState(""), V = A.useRef(!0), k = () => {
    try {
      if (y.current === g.current) {
        localStorage.removeItem(r);
        return;
      }
      localStorage.setItem(
        r,
        JSON.stringify({ revision: v.current, draft: m.current })
      );
    } catch {
      Q("浏览器无法保留本地草稿，请保持页面打开并保存");
    }
  }, H = A.useCallback((j, B = !0) => {
    JSON.stringify(m.current) !== JSON.stringify(j) && (B && (_.current.push(uc(m.current)), _.current = _.current.slice(-80), C.current = [], M((X) => X + 1)), m.current = j, y.current++, h(j), w.current || S("dirty"), k());
  }, []), q = A.useCallback(
    (j, B = !0) => H(j(m.current), B),
    [H]
  ), de = A.useCallback(() => {
    N.current || (N.current = uc(m.current));
  }, []), ee = A.useCallback(() => {
    N.current && JSON.stringify(N.current) !== JSON.stringify(m.current) && (_.current.push(N.current), _.current = _.current.slice(-80), C.current = [], M((j) => j + 1)), N.current = null;
  }, []), me = A.useCallback(
    (j = !1) => {
      ee();
      const B = j ? C.current : _.current, X = j ? _.current : C.current, J = B.pop();
      J && (X.push(uc(m.current)), H(J, !1), M((I) => I + 1));
    },
    [H, ee]
  ), te = A.useCallback(async () => {
    if (w.current) throw new Error("请先处理保存冲突");
    if (E.current)
      return await E.current, te();
    if (y.current === g.current) return v.current;
    const j = uc(m.current), B = y.current;
    S("saving"), Q("");
    const X = ln(
      `/api/canvases/${n.id}/document`,
      { ...j, expected_revision: v.current },
      "PUT"
    ).then((J) => (v.current = J.revision, g.current = B, V.current && (y.current === B && (m.current = { title: J.title, document: J.document }, h(m.current)), S(y.current === B ? "saved" : "dirty"), k()), v.current)).catch((J) => {
      throw V.current && (J instanceof Wr && J.status === 409 ? (w.current = !0, S("conflict")) : S("error"), Q(J.message)), J;
    }).finally(() => {
      E.current = null;
    });
    return E.current = X, await X, y.current !== g.current ? te() : v.current;
  }, [n.id]);
  return A.useEffect(() => {
    if (p !== "dirty") return;
    const j = setTimeout(() => {
      N.current || te().catch(() => {
      });
    }, 800);
    return () => clearTimeout(j);
  }, [f, p, D, te]), A.useEffect(() => {
    const j = (B) => {
      y.current !== g.current && (k(), B.preventDefault(), B.returnValue = "");
    };
    return window.addEventListener("beforeunload", j), () => {
      V.current = !1, window.removeEventListener("beforeunload", j);
    };
  }, []), {
    value: f,
    ref: m,
    revision: v,
    change: q,
    begin: de,
    end: ee,
    travel: me,
    flush: te,
    status: p,
    error: R,
    reload: () => {
      g.current = y.current, w.current = !1, localStorage.removeItem(r), location.reload();
    },
    acceptRemote: (j, B) => {
      if (JSON.stringify(m.current) !== B)
        throw w.current = !0, S("conflict"), Q("采用回答期间画布发生了修改。你的本地草稿已保留，请先处理保存冲突。"), k(), new Error("画布有新的本地修改，请先处理保存冲突");
      _.current.push(uc(m.current)), C.current = [], M((X) => X + 1), v.current = j.revision, m.current = { title: j.title, document: j.document }, h(m.current), y.current++, g.current = y.current, S("saved"), k();
    },
    canUndo: _.current.length > 0,
    canRedo: C.current.length > 0,
    dirty: y.current !== g.current
  };
}
const Kk = {
  model: "",
  ratio: "16:9",
  quality: 480,
  seconds: 5,
  seed: null,
  sampling_steps: 20,
  fast_mode: !1,
  resolution: "1K",
  image_quality: "medium"
}, bc = {
  text: "文本",
  image: "图片",
  video: "视频",
  sticky: "便签"
}, us = (n, a, s, r) => ({
  id: crypto.randomUUID(),
  type: n,
  title: bc[n] + " " + r,
  x: a,
  y: s,
  width: 320,
  height: 240,
  text: "",
  prompt: "",
  color: n === "sticky" ? "yellow" : "none",
  media_id: null,
  active_job: null,
  params: { ...Kk }
});
function Oi(n, a) {
  const s = a.filter((f) => f.canvas_node === n.id), r = s[0], o = n.use_media ? void 0 : n.active_job ? s.find((f) => f.id === n.active_job) : r;
  return {
    run: o,
    latest: r,
    list: s,
    media: o ? o.status === "done" ? o.result : null : n.media_id
  };
}
function pf(n, a, s) {
  const r = n.nodes.find((m) => m.id === a), o = n.nodes.find((m) => m.id === s);
  if (!r || !o || a === s || !["text", "image"].includes(r.type) || !["image", "video"].includes(o.type))
    return "这两个节点不能连接";
  if (n.edges.some((m) => m.source === a && m.target === s))
    return "已经连接";
  if (r.type === "image" && n.edges.filter(
    (m) => m.target === s && n.nodes.find((v) => v.id === m.source)?.type === "image"
  ).length >= 9)
    return "最多连接 9 张参考图片";
  const f = /* @__PURE__ */ new Set(), h = [s];
  for (; h.length; ) {
    const m = h.pop();
    if (m === a) return "连线不能形成循环";
    f.has(m) || (f.add(m), h.push(
      ...n.edges.filter((v) => v.source === m).map((v) => v.target)
    ));
  }
  return "";
}
function yw(n) {
  return n?.actual?.duration ? n.actual.duration : n?.model === "MiniMax H3" ? ({ 5: 124, 10: 243, 15: 362 }[n.seconds] || n.seconds * 24) / 24 : n?.seconds || 0;
}
function Wp() {
  return { async: !1, breaks: !1, extensions: null, gfm: !0, hooks: null, pedantic: !1, renderer: null, silent: !1, tokenizer: null, walkTokens: null };
}
var sr = Wp();
function vw(n) {
  sr = n;
}
var Gs = { exec: () => null };
function Vs(n) {
  let a = [];
  return (s) => {
    let r = Math.max(0, Math.min(3, s - 1)), o = a[r];
    return o || (o = n(r), a[r] = o), o;
  };
}
function Je(n, a = "") {
  let s = typeof n == "string" ? n : n.source, r = { replace: (o, f) => {
    let h = typeof f == "string" ? f : f.source;
    return h = h.replace(Hn.caret, "$1"), s = s.replace(o, h), r;
  }, getRegex: () => new RegExp(s, a) };
  return r;
}
var xw = ((n = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + n);
  } catch {
    return !1;
  }
})(), Hn = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, leadingSpaceTab: /^[ \t]+/, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\][ \t]+\S/, listReplaceTask: /^\[[ xX]\][ \t]+/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/, numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (n) => new RegExp(`^( {0,3}${n})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: Vs((n) => new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: Vs((n) => new RegExp(`^ {0,${n}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: Vs((n) => new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`)), headingBeginRegex: Vs((n) => new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`)), pedanticHeadingBeginRegex: Vs((n) => new RegExp(`^ {0,${n}}#`)), htmlBeginRegex: Vs((n) => new RegExp(`^ {0,${n}}(?:</?(?:${Ic})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, "i")), blockquoteBeginRegex: Vs((n) => new RegExp(`^ {0,${n}}>`)) }, Pk = /^(?:[ \t]*(?:\n|$))+/, Jk = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/, Fk = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/, Yc = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/, Wk = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/, eg = / {0,3}(?:[*+-]|\d{1,9}[.)])/, bw = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/, Sw = Je(bw).replace(/bull/g, eg).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex(), ej = Je(bw).replace(/bull/g, eg).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(), tg = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/, tj = /^[^\n]+/, ng = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/, nj = Je(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", ng).replace("title", /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/).getRegex(), ij = Je(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, eg).getRegex(), Ic = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul", ig = /<!--(?:-?>|[\s\S]*?(?:-->|$))/, aj = Je("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ig).replace("tag", Ic).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(), ww = (n) => Je(tg).replace("hr", Yc).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", n).replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Ic).getRegex(), lj = ww(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/), sj = ww(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/), rj = Je(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace("paragraph", sj).getRegex(), ag = { blockquote: rj, code: Jk, def: nj, fences: Fk, heading: Wk, hr: Yc, html: aj, lheading: Sw, list: ij, newline: Pk, paragraph: lj, table: Gs, text: tj }, O1 = Je("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", Yc).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Ic).getRegex(), oj = { ...ag, lheading: ej, table: O1, paragraph: Je(tg).replace("hr", Yc).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", O1).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Ic).getRegex() }, cj = { ...ag, html: Je(`^ *(?:comment(?: *\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1>(?: *\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?>(?: *\\n{2,}|\\s*$))`).replace("comment", ig).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: Gs, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: Je(tg).replace("hr", Yc).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", Sw).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() }, uj = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/, fj = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/, _w = /^( {2,}|\\)\n(?!\s*$)[ \t]*/, dj = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/, fl = /[\p{P}\p{S}]/u, vo = /[\s\p{P}\p{S}]/u, Xc = /[^\s\p{P}\p{S}]/u, hj = Je(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, vo).getRegex(), mj = /[\p{Pi}\p{Ps}"']/u, Ew = /(?!~)[\p{P}\p{S}]/u, pj = /(?!~)[\s\p{P}\p{S}]/u, gj = /(?:[^\s\p{P}\p{S}]|~)/u, yj = Je(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", xw ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex(), Nw = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/, vj = Je(Nw, "u").replace(/punct/g, fl).getRegex(), xj = Je(Nw, "u").replace(/punct/g, Ew).getRegex(), bj = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/, Sj = Je(bj, "u").replace(/openQuote/g, mj).replace(/punct/g, fl).getRegex(), Tw = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)", wj = Je(Tw, "gu").replace(/notPunctSpace/g, Xc).replace(/punctSpace/g, vo).replace(/punct/g, fl).getRegex(), _j = Je(Tw, "gu").replace(/notPunctSpace/g, gj).replace(/punctSpace/g, pj).replace(/punct/g, Ew).getRegex(), Ej = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)", Nj = Je(Ej, "gu").replace(/notPunctSpace/g, Xc).replace(/punctSpace/g, vo).replace(/punct/g, fl).getRegex(), Tj = Je("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Xc).replace(/punctSpace/g, vo).replace(/punct/g, fl).getRegex(), Cj = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)", Aj = Je(Cj, "gu").replace(/notPunctSpace/g, Xc).replace(/punctSpace/g, vo).replace(/punct/g, fl).getRegex(), Mj = Je(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, fl).getRegex(), zj = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", kj = Je(zj, "gu").replace(/notPunctSpace/g, Xc).replace(/punctSpace/g, vo).replace(/punct/g, fl).getRegex(), jj = Je(/\\(punct)/, "gu").replace(/punct/g, fl).getRegex(), Rj = Je(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, "gu").replace(/punct/g, fl).getRegex(), Oj = Je(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(), Dj = Je(ig).replace("(?:-->|$)", "-->").getRegex(), Hj = Je("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Dj).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(), Cw = /\[(?:\\[\s\S]|[^\[\]\\])*\]/, qf = Je(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", Cw).getRegex(), Lj = Je(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", qf).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/).getRegex(), Uj = Je(/^!?\[(label)\]\[(ref)\]/).replace("label", qf).replace("ref", ng).getRegex(), Bj = Je(/^!?\[(ref)\](?:\[\])?/).replace("ref", ng).getRegex(), D1 = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/, $j = Je(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", Cw).getRegex(), qj = Je("reflink|nolink(?!\\()", "g").replace("reflink", Je(/^!?\[(label)\]\[(ref)\]/).replace("label", $j).replace("ref", D1).getRegex()).replace("nolink", Je(/^!?\[(ref)\](?:\[\])?/).replace("ref", D1).getRegex()).getRegex(), H1 = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/, Vj = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/, Yj = Je(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, Vj).getRegex(), lg = { _backpedal: Gs, anyPunctuation: jj, anyPunctuationOutsideCode: Rj, autolink: Oj, blockSkip: yj, br: _w, code: fj, del: Gs, delLDelim: Gs, delRDelim: Gs, emStrongLDelim: vj, emStrongRDelimAst: wj, emStrongRDelimUnd: Tj, escape: uj, link: Lj, nolink: Bj, punctuation: hj, reflink: Uj, reflinkSearch: qj, tag: Hj, text: dj, url: Gs }, Ij = { ...lg, emStrongLDelim: Sj, emStrongRDelimAst: Nj, emStrongRDelimUnd: Aj, link: Je(/^!?\[(label)\]\((.*?)\)/).replace("label", qf).getRegex(), reflink: Je(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", qf).getRegex() }, wp = { ...lg, emStrongRDelimAst: _j, emStrongLDelim: xj, delLDelim: Mj, delRDelim: kj, url: Je(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", Yj).replace("protocol", H1).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: Je(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", H1).replace(/emailProtocol/g, /(?:mailto|xmpp):/).replace("wwwStart", xw ? "(?<![^\\s*_~(])www\\." : "www\\.").getRegex() }, Xj = { ...wp, br: Je(_w).replace("{2,}", "*").getRegex(), text: Je(wp.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() }, gf = { normal: ag, gfm: oj, pedantic: cj }, fc = { normal: lg, gfm: wp, breaks: Xj, pedantic: Ij }, Gj = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }, L1 = (n) => Gj[n];
function Pi(n, a) {
  if (a) {
    if (Hn.escapeTest.test(n)) return n.replace(Hn.escapeReplace, L1);
  } else if (Hn.escapeTestNoEncode.test(n)) return n.replace(Hn.escapeReplaceNoEncode, L1);
  return n;
}
function Zj(n) {
  return Hn.numericCharacterReference.test(n) ? n.replace(Hn.numericCharacterReferenceOrAmpersand, (a, s, r) => {
    if (s === void 0 && r === void 0) return "&amp;";
    let o = s === void 0 ? Number.parseInt(r, 16) : Number.parseInt(s, 10);
    return o === 0 || o > 1114111 || o >= 55296 && o <= 57343 ? "�" : o === 38 ? "&amp;" : String.fromCodePoint(o);
  }) : n;
}
function U1(n) {
  try {
    n = encodeURI(n).replace(Hn.percentDecode, "%");
  } catch {
    return null;
  }
  return n;
}
function B1(n, a) {
  let s = n.replace(Hn.findPipe, (f, h, m) => {
    let v = !1, y = h;
    for (; --y >= 0 && m[y] === "\\"; ) v = !v;
    return v ? "|" : " |";
  }), r = s.split(Hn.splitPipe), o = 0;
  if (r[0].trim() || r.shift(), r.length > 0 && !r.at(-1)?.trim() && r.pop(), a) if (r.length > a) r.splice(a);
  else for (; r.length < a; ) r.push("");
  for (; o < r.length; o++) r[o] = r[o].trim().replace(Hn.slashPipe, "|");
  return r;
}
function Al(n, a, s) {
  let r = n.length;
  if (r === 0) return "";
  let o = 0;
  for (; o < r && n.charAt(r - o - 1) === a; )
    o++;
  return n.slice(0, r - o);
}
function $1(n) {
  let a = n.split(`
`), s = a.length - 1;
  for (; s >= 0 && Hn.blankLine.test(a[s]); ) s--;
  return a.length - s <= 2 ? n : a.slice(0, s + 1).join(`
`);
}
function Vf(n) {
  return n.trim().replace(Hn.multipleSpaceGlobal, " ").toLowerCase().toUpperCase().toLowerCase();
}
function q1(n, a) {
  if (n.indexOf(a[0]) === -1 && n.indexOf(a[1]) === -1) return -1;
  let s = 0;
  for (let r = 0; r < n.length; r++) if (n[r] === "\\") r++;
  else if (n[r] === a[0]) s++;
  else if (n[r] === a[1] && (s--, s < 0)) return r;
  return s > 0 ? -2 : -1;
}
var go = /* @__PURE__ */ new WeakMap();
function sg(n) {
  let a = { "*": -1, _: -1 }, s = -1, r = n.length;
  for (let o = 0; o < r; o++) {
    let f = n[o];
    if (f !== "*" && f !== "_" && f !== "~") continue;
    let h = o === 0 ? `
` : n[o - 1], m = o + 1;
    for (; m < r && n[m] === f; ) m++;
    h !== " " && h !== "	" && h !== `
` && h !== "\r" && h !== "\f" && (f === "~" ? s = o : a[f] = o), o = m - 1;
  }
  return { maskedSrc: n, lastPossibleEmStrongCloserIndex: a, lastPossibleDelCloserIndex: s };
}
function Qj(n, a) {
  let s = sg(a), r = go.get(n);
  r ? r.push(s) : go.set(n, [s]);
}
function Kj(n) {
  let a = go.get(n);
  a && (a.pop(), a.length === 0 && go.delete(n));
}
function Pj(n, a, s) {
  let r = go.get(n)?.at(-1);
  return r && r.maskedSrc === a ? r.lastPossibleEmStrongCloserIndex[s] : sg(a).lastPossibleEmStrongCloserIndex[s];
}
function Jj(n, a) {
  let s = go.get(n)?.at(-1);
  return s && s.maskedSrc === a ? s.lastPossibleDelCloserIndex : sg(a).lastPossibleDelCloserIndex;
}
function yf(n, a = 0) {
  let s = a, r = "";
  for (let o of n) if (o === "	") {
    let f = 4 - s % 4;
    r += " ".repeat(f), s += f;
  } else r += o, s++;
  return r;
}
function V1(n, a, s, r, o) {
  let f = a.href, h = a.title || null, m = n[1].replace(o.other.outputLinkReplace, "$1"), v = n[0].charAt(0) === "!", y = r.state.inLink, g = r.state.linkEmitted, p = r.state.inRawBlock;
  r.state.inLink = !0, r.state.linkEmitted = !1;
  let S = r.inlineTokens(m), w = r.state.linkEmitted;
  if (r.state.linkEmitted = g, r.state.inLink = y, !v) {
    if (w) {
      r.state.inRawBlock = p;
      return;
    }
    r.state.linkEmitted = !0;
  }
  return { type: v ? "image" : "link", raw: s, href: f, title: h, text: m, tokens: S };
}
function Fj(n, a, s) {
  let r = n.match(s.other.indentCodeCompensation);
  if (r === null) return a;
  let o = r[1];
  return a.split(`
`).map((f) => {
    let h = f.match(s.other.beginningSpace);
    if (h === null) return f;
    let [m] = h;
    return f.slice(Math.min(m.length, o.length));
  }).join(`
`);
}
function Y1(n, a, s, r) {
  if (!a.includes("<")) return !1;
  for (let o = 0; o < a.length; o++) {
    if (a[o] === "\\") {
      o++;
      continue;
    }
    if (a[o] === "`") {
      let m = r.inline.code.exec(a.slice(o));
      if (m) {
        o += m[0].length - 1;
        continue;
      }
    }
    if (a[o] !== "<") continue;
    let f = n.slice(s + o), h = r.inline.tag.exec(f) || r.inline.autolink.exec(f);
    if (h) {
      if (h[0].length > a.length - o) return !0;
      o += h[0].length - 1;
    }
  }
  return !1;
}
var ao = class {
  options;
  rules;
  lexer;
  constructor(n) {
    this.options = n || sr;
  }
  space(n) {
    let a = this.rules.block.newline.exec(n);
    if (a && a[0].length > 0) return { type: "space", raw: a[0] };
  }
  code(n) {
    let a = this.rules.block.code.exec(n);
    if (a) {
      let s = this.options.pedantic ? a[0] : $1(a[0]), r = s.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: s, codeBlockStyle: "indented", text: r };
    }
  }
  fences(n) {
    let a = this.rules.block.fences.exec(n);
    if (a) {
      let s = a[0], r = Fj(s, a[3] || "", this.rules);
      return { type: "code", raw: s, lang: a[2] ? a[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : a[2], text: r };
    }
  }
  heading(n) {
    let a = this.rules.block.heading.exec(n);
    if (a) {
      let s = a[2].trim();
      if (this.rules.other.endingHash.test(s)) {
        let r = Al(s, "#");
        (this.options.pedantic || !r || this.rules.other.endingSpaceTabChar.test(r)) && (s = r.trim());
      }
      return { type: "heading", raw: Al(a[0], `
`), depth: a[1].length, text: s, tokens: this.lexer.inline(s) };
    }
  }
  hr(n) {
    let a = this.rules.block.hr.exec(n);
    if (a) return { type: "hr", raw: Al(a[0], `
`) };
  }
  blockquote(n) {
    let a = this.rules.block.blockquote.exec(n);
    if (a) {
      let s = Al(a[0], `
`).split(`
`), r = "", o = "", f = [];
      for (; s.length > 0; ) {
        let h = !1, m = [], v;
        for (v = 0; v < s.length; v++) if (this.rules.other.blockquoteStart.test(s[v])) m.push(s[v]), h = !0;
        else if (!h) m.push(s[v]);
        else break;
        s = s.slice(v);
        let y = m.join(`
`), g = y.replace(this.rules.other.blockquoteMarkerWhitespace, (w, E, N) => E + yf(N, E.length)).replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        r = r ? `${r}
${y}` : y, o = o ? `${o}
${g}` : g;
        let p = this.lexer.state.top;
        if (this.lexer.state.top = !0, this.lexer.blockTokens(g, f, !0), this.lexer.state.top = p, s.length === 0) break;
        let S = f.at(-1);
        if (S?.type === "code" || S?.type === "heading" || S?.type === "hr" || S?.type === "html" || S?.type === "table") break;
        if (S?.type === "blockquote") {
          let w = S, E = s.join(`
`), N = w.raw + `
` + E.replace(this.rules.other.blockquoteSetextReplace2, ""), _ = this.blockquote(N);
          f[f.length - 1] = _;
          let C = N.substring(_.raw.length).replace(/^\n/, ""), D = C ? C.split(`
`).length : 0, M = D ? s.slice(0, -D) : s;
          if (M.length > 0 && (r = `${r}
${M.join(`
`)}`), o = o.substring(0, o.length - w.text.length) + _.text, s = s.slice(M.length), s.length > 0 && this.rules.other.blockquoteStart.test(s[0])) continue;
          break;
        } else if (S?.type === "list") {
          let w = S, E = w.raw + `
` + s.join(`
`), N = this.list(E);
          f[f.length - 1] = N;
          let _ = N.raw.length > w.raw.length ? E.slice(w.raw.length + 1, N.raw.length).split(`
`).length : 0;
          if (_ > 0) {
            let C = s.slice(0, _).join(`
`);
            r = `${r}
${C}`, o = `${o}
${C}`;
          }
          s = s.slice(_);
          continue;
        }
      }
      return { type: "blockquote", raw: r, tokens: f, text: o };
    }
  }
  list(n) {
    let a = this.rules.block.list.exec(n);
    if (a) {
      let s = n, r = () => s.length - n.length, o = a[1].trim(), f = o.length > 1, h = { type: "list", raw: "", ordered: f, start: f ? +o.slice(0, -1) : "", loose: !1, items: [] };
      o = f ? `\\d{1,9}\\${o.slice(-1)}` : `\\${o}`, this.options.pedantic && (o = f ? o : "[*+-]");
      let m = this.rules.other.listItemRegex(o), v = !1;
      for (; n; ) {
        let g = !1, p = "";
        if (!(a = m.exec(n)) || this.rules.block.hr.test(n)) break;
        let S = r();
        n = n.substring(a[0].length);
        let w = a[2].split(`
`, 1)[0], E = a[1].length, N = this.options.pedantic ? yf(w, E) : w.replace(this.rules.other.leadingSpaceTab, (R) => yf(R, E)), _ = n.split(`
`, 1)[0], C = !N.trim(), D = 0;
        if (this.options.pedantic ? (D = 2, p = N.trimStart()) : C ? D = E + 1 : (D = N.search(this.rules.other.nonSpaceChar), D = D > 4 ? 1 : D, p = N.slice(D), D += E), C && this.rules.other.blankLine.test(_) && (n = n.substring(_.length + 1), g = !0), !g) {
          let R = this.rules.other.nextBulletRegex(D), Q = this.rules.other.hrRegex(D), V = this.rules.other.fencesBeginRegex(D), k = this.options.pedantic ? this.rules.other.pedanticHeadingBeginRegex(D) : this.rules.other.headingBeginRegex(D), H = this.rules.other.htmlBeginRegex(D), q = this.rules.other.blockquoteBeginRegex(D);
          for (; n; ) {
            let de = n.split(`
`, 1)[0], ee;
            if (_ = de, this.options.pedantic ? (_ = _.replace(this.rules.other.listReplaceNesting, "  "), ee = _) : ee = _.replace(this.rules.other.leadingSpaceTab, (me) => yf(me)), V.test(_) || k.test(_) || H.test(_) || q.test(_) || R.test(_) || Q.test(_)) break;
            if (ee.search(this.rules.other.nonSpaceChar) >= D || !_.trim()) p += `
` + ee.slice(D);
            else {
              if (C || N.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || V.test(N) || k.test(N) || H.test(N) || Q.test(N)) break;
              let me = !this.options.pedantic && /^ {0,3}(?:=+|-+) *$/.test(_) && this.rules.block.lheading.test(`${N}
${_}`) ? `    ${ee.replace(/^ {0,3}/, "")}` : _;
              p += `
` + me;
            }
            C = !_.trim(), n = n.substring(de.length + 1), N = ee.slice(D);
          }
        }
        let M = s.slice(S, r());
        h.loose || (v ? h.loose = !0 : this.rules.other.doubleBlankLine.test(M) && (v = !0)), h.items.push({ type: "list_item", raw: M, task: !!this.options.gfm && this.rules.other.listIsTask.test(p), loose: !1, text: p, tokens: [] });
      }
      let y = h.items.at(-1);
      if (y) y.raw = y.raw.trimEnd(), y.text = y.text.trimEnd();
      else return;
      h.raw = s.slice(0, r()).trimEnd();
      for (let g of h.items) if (this.lexer.state.top = !1, g.tokens = this.lexer.blockTokens(g.text, []), !h.loose) {
        let p = g.tokens.filter((w) => w.type === "space"), S = p.length > 0 && p.some((w) => this.rules.other.anyLine.test(w.raw));
        h.loose = S;
      }
      for (let g of h.items) {
        let p = g.tokens[0];
        if (g.task && (p?.type === "text" || p?.type === "paragraph")) {
          g.text = g.text.replace(this.rules.other.listReplaceTask, ""), p.raw = p.raw.replace(this.rules.other.listReplaceTask, ""), p.text = p.text.replace(this.rules.other.listReplaceTask, "");
          for (let w = this.lexer.inlineQueue.length - 1; w >= 0; w--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[w].src)) {
            this.lexer.inlineQueue[w].src = this.lexer.inlineQueue[w].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let S = this.rules.other.listTaskCheckbox.exec(g.raw);
          if (S) {
            let w = { type: "checkbox", raw: S[0] + " ", checked: S[0] !== "[ ]" };
            g.checked = w.checked, h.loose ? g.tokens[0] && ["paragraph", "text"].includes(g.tokens[0].type) && "tokens" in g.tokens[0] && g.tokens[0].tokens ? (g.tokens[0].raw = w.raw + g.tokens[0].raw, g.tokens[0].text = w.raw + g.tokens[0].text, g.tokens[0].tokens.unshift(w)) : g.tokens.unshift({ type: "paragraph", raw: w.raw, text: w.raw, tokens: [w] }) : g.tokens.unshift(w);
          }
        } else g.task && (g.task = !1);
      }
      if (h.loose) for (let g of h.items) {
        g.loose = !0;
        for (let p of g.tokens) p.type === "text" && (p.type = "paragraph");
      }
      return h;
    }
  }
  html(n) {
    let a = this.rules.block.html.exec(n);
    if (a) {
      let s = $1(a[0]);
      return { type: "html", block: !0, raw: s, pre: a[1] === "pre" || a[1] === "script" || a[1] === "style", text: s };
    }
  }
  def(n) {
    let a = this.rules.block.def.exec(n);
    if (a) {
      if (!this.rules.other.startAngleBracket.test(a[2]) && q1(a[2], "()") !== -1) return;
      let s = Vf(a[1]), r = a[2] ? a[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", o = a[3] ? a[3].substring(1, a[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : a[3];
      return { type: "def", tag: s, raw: Al(a[0], `
`), href: r, title: o };
    }
  }
  table(n) {
    let a = this.rules.block.table.exec(n);
    if (!a || !this.rules.other.tableDelimiter.test(a[2])) return;
    let s = B1(a[1]), r = a[2].replace(this.rules.other.tableAlignChars, "").split("|"), o = a[3]?.trim() ? a[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], f = { type: "table", raw: Al(a[0], `
`), header: [], align: [], rows: [] };
    if (s.length === r.length) {
      for (let h of r) this.rules.other.tableAlignRight.test(h) ? f.align.push("right") : this.rules.other.tableAlignCenter.test(h) ? f.align.push("center") : this.rules.other.tableAlignLeft.test(h) ? f.align.push("left") : f.align.push(null);
      for (let h = 0; h < s.length; h++) f.header.push({ text: s[h], tokens: this.lexer.inline(s[h]), header: !0, align: f.align[h] });
      for (let h of o) f.rows.push(B1(h, f.header.length).map((m, v) => ({ text: m, tokens: this.lexer.inline(m), header: !1, align: f.align[v] })));
      return f;
    }
  }
  lheading(n) {
    let a = this.rules.block.lheading.exec(n);
    if (a) {
      let s = a[1].trim();
      return { type: "heading", raw: Al(a[0], `
`), depth: a[2].charAt(0) === "=" ? 1 : 2, text: s, tokens: this.lexer.inline(s) };
    }
  }
  paragraph(n) {
    let a = this.rules.block.paragraph.exec(n);
    if (a) {
      let s = a[1].charAt(a[1].length - 1) === `
` ? a[1].slice(0, -1) : a[1];
      return { type: "paragraph", raw: a[0], text: s, tokens: this.lexer.inline(s) };
    }
  }
  text(n) {
    let a = this.rules.block.text.exec(n);
    if (a) return { type: "text", raw: a[0], text: a[0], tokens: this.lexer.inline(a[0]) };
  }
  escape(n) {
    let a = this.rules.inline.escape.exec(n);
    if (a) return { type: "escape", raw: a[0], text: a[1] };
  }
  tag(n) {
    let a = this.rules.inline.tag.exec(n);
    if (a) return !this.lexer.state.inLink && this.rules.other.startATag.test(a[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(a[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(a[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(a[0]) && (this.lexer.state.inRawBlock = !1), { type: "html", raw: a[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: !1, text: a[0] };
  }
  link(n) {
    if (this.lexer.state.linkParenPossible === !1) return;
    let a = this.rules.inline.link.exec(n);
    if (a) {
      let s = a[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && Y1(n, a[1], s, this.rules)) return;
      let r = a[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(r)) {
        if (!this.rules.other.endAngleBracket.test(r)) return;
        let m = Al(r.slice(0, -1), "\\");
        if ((r.length - m.length) % 2 === 0) return;
      } else {
        let m = q1(a[2], "()");
        if (m === -2) return;
        if (m > -1) {
          let v = (a[0].indexOf("!") === 0 ? 5 : 4) + a[1].length + m;
          a[2] = a[2].substring(0, m), a[0] = a[0].substring(0, v).trim(), a[3] = "";
        }
      }
      let o = Al(a[0].slice(0, -1), "\\");
      if ((a[0].length - o.length) % 2 === 0) return;
      let f = a[2], h = "";
      if (this.options.pedantic) {
        let m = this.rules.other.pedanticHrefTitle.exec(f);
        m && (f = m[1], h = m[3]);
      } else h = a[3] ? a[3].slice(1, -1) : "";
      return f = f.trim(), this.rules.other.startAngleBracket.test(f) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(r) ? f = f.slice(1) : f = f.slice(1, -1)), V1(a, { href: f && f.replace(this.rules.inline.anyPunctuation, "$1"), title: h && h.replace(this.rules.inline.anyPunctuation, "$1") }, a[0], this.lexer, this.rules);
    }
  }
  reflink(n, a) {
    let s;
    if ((s = this.rules.inline.reflink.exec(n)) || (s = this.rules.inline.nolink.exec(n))) {
      let r = s[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && Y1(n, s[1], r, this.rules)) return;
      let o = a[Vf(s[2] || s[1])];
      if (!o) {
        let f = s[0].charAt(0);
        return { type: "text", raw: f, text: f };
      }
      return V1(s, o, s[0], this.lexer, this.rules);
    }
  }
  emStrong(n, a, s = "") {
    let r = this.rules.inline.emStrongLDelim.exec(n);
    if (!r || !r[1] && !r[2] && !r[3] && !r[4]) return;
    let o = r[0][0], f = s === o, h = a.length - n.length, m = h;
    for (; !this.options.pedantic && m > 0 && a[m - 1] === o; ) m--;
    let v = [...a.slice(Math.max(0, m - 2), m)].at(-1) ?? "", y = v === "*" || v === "_" || !!this.rules.inline.punctuation.exec(v);
    m < h && (s = v);
    let g = m < h ? y : !!this.rules.inline.punctuation.exec(s);
    if (r[4] && s.match(this.rules.other.unicodeAlphaNumeric)) return;
    let p = r[1] || r[3] || "";
    if (!p || !s || g) {
      let S = [...r[0]].length - 1, w, E, N = S, _ = 0, C = h - m + S, D = !this.options.pedantic && !!v.trim() && (!!p || o === "*" && !y);
      if (o !== "*" && o !== "_") return;
      let M = o === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd, R = Pj(this, a, o), Q = a.length - n.length + S;
      if (R < Q) return;
      a = a.slice(-1 * n.length + S);
      let V = R - Q;
      for (M.lastIndex = 0; (r = M.exec(a)) !== null && !(r.index > V); ) {
        if (w = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !w) continue;
        if (E = [...w].length, r[3] || r[4]) {
          N += E;
          continue;
        } else if (r[5] || r[6] || D) {
          if (f && (r[5] || r[6])) break;
          if (C % 3 && !((C + E) % 3)) {
            _ += E;
            continue;
          }
        }
        if (N -= E, N > 0) continue;
        E = Math.min(E, E + N + _);
        let k = [...r[0]][0].length, H = n.slice(0, S + r.index + k + E);
        if (Math.min(S, E) % 2) {
          let de = H.slice(1, -1);
          return { type: "em", raw: H, text: de, tokens: this.lexer.inlineTokens(de) };
        }
        let q = H.slice(2, -2);
        return { type: "strong", raw: H, text: q, tokens: this.lexer.inlineTokens(q) };
      }
    }
  }
  codespan(n) {
    let a = this.rules.inline.code.exec(n);
    if (a) {
      let s = a[2].replace(this.rules.other.newLineCharGlobal, " "), r = this.rules.other.nonSpaceChar.test(s), o = this.rules.other.startingSpaceChar.test(s) && this.rules.other.endingSpaceChar.test(s);
      return r && o && (s = s.substring(1, s.length - 1)), { type: "codespan", raw: a[0], text: s };
    }
  }
  br(n) {
    let a = this.rules.inline.br.exec(n);
    if (a) return { type: "br", raw: a[0] };
  }
  del(n, a, s = "") {
    let r = this.rules.inline.delLDelim.exec(n);
    if (r && (!r[1] || !s || this.rules.inline.punctuation.exec(s))) {
      let o = [...r[0]].length - 1, f, h, m = o, v = this.rules.inline.delRDelim, y = Jj(this, a), g = a.length - n.length + o;
      if (y < g) return;
      a = a.slice(-1 * n.length + o);
      let p = y - g;
      for (v.lastIndex = 0; (r = v.exec(a)) !== null && !(r.index > p); ) {
        if (f = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !f || (h = [...f].length, h !== o)) continue;
        if (r[3] || r[4]) {
          m += h;
          continue;
        }
        if (m -= h, m > 0) continue;
        h = Math.min(h, h + m);
        let S = [...r[0]][0].length, w = n.slice(0, o + r.index + S + h), E = w.slice(o, -o);
        return { type: "del", raw: w, text: E, tokens: this.lexer.inlineTokens(E) };
      }
    }
  }
  autolink(n) {
    let a = this.rules.inline.autolink.exec(n);
    if (a) {
      let s, r;
      return a[2] === "@" ? (s = a[1], r = "mailto:" + s) : (s = a[1], r = s), { type: "link", raw: a[0], text: s, href: r, autolink: !0, tokens: [{ type: "text", raw: s, text: s }] };
    }
  }
  url(n) {
    let a;
    if (a = this.rules.inline.url.exec(n)) {
      let s, r;
      if (a[2] === "@") s = a[0], r = "mailto:" + s;
      else {
        let o;
        do
          o = a[0], a[0] = this.rules.inline._backpedal.exec(a[0])?.[0] ?? "";
        while (o !== a[0]);
        s = a[0], a[1] === "www." ? r = "http://" + a[0] : r = a[0];
      }
      return { type: "link", raw: a[0], text: s, href: r, autolink: !0, tokens: [{ type: "text", raw: s, text: s }] };
    }
  }
  inlineText(n) {
    let a = this.rules.inline.text.exec(n);
    if (a) {
      let s = this.lexer.state.inRawBlock;
      return { type: "text", raw: a[0], text: s ? a[0] : Zj(a[0]), escaped: s };
    }
  }
}, ja = class _p {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(a) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = a || sr, this.options.tokenizer = this.options.tokenizer || new ao(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: !1, inRawBlock: !1, linkEmitted: !1, linkParenPossible: !0, top: !0 };
    let s = { other: Hn, block: gf.normal, inline: fc.normal };
    this.options.pedantic ? (s.block = gf.pedantic, s.inline = fc.pedantic) : this.options.gfm && (s.block = gf.gfm, this.options.breaks ? s.inline = fc.breaks : s.inline = fc.gfm), this.tokenizer.rules = s;
  }
  static get rules() {
    return { block: gf, inline: fc };
  }
  static lex(a, s) {
    return new _p(s).lex(a);
  }
  static lexInline(a, s) {
    return new _p(s).inlineTokens(a);
  }
  lex(a) {
    a = a.replace(Hn.carriageReturn, `
`), this.blockTokens(a, this.tokens);
    for (let s = 0; s < this.inlineQueue.length; s++) {
      let r = this.inlineQueue[s];
      this.state.inRawBlock = !1, this.inlineTokens(r.src, r.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(a, s = [], r = !1) {
    this.tokenizer.lexer = this, this.options.pedantic && (a = a.replace(Hn.tabCharGlobal, "    ").replace(Hn.spaceLine, ""));
    let o = 1 / 0;
    for (; a; ) {
      if (a.length < o) o = a.length;
      else {
        this.infiniteLoopError(a.charCodeAt(0));
        break;
      }
      let f;
      if (this.options.extensions?.block?.some((m) => (f = m.call({ lexer: this }, a, s)) ? (a = a.substring(f.raw.length), s.push(f), !0) : !1)) continue;
      if (f = this.tokenizer.space(a)) {
        a = a.substring(f.raw.length);
        let m = s.at(-1);
        f.raw.length === 1 && m !== void 0 ? m.raw += `
` : s.push(f);
        continue;
      }
      if (f = this.tokenizer.code(a)) {
        a = a.substring(f.raw.length);
        let m = s.at(-1);
        m?.type === "paragraph" || m?.type === "text" ? (m.raw += (m.raw.endsWith(`
`) ? "" : `
`) + f.raw, m.text += `
` + f.text, this.inlineQueue.at(-1).src = m.text) : s.push(f);
        continue;
      }
      if (f = this.tokenizer.fences(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.heading(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.hr(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.blockquote(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.list(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.html(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.def(a)) {
        a = a.substring(f.raw.length);
        let m = s.at(-1);
        m?.type === "paragraph" || m?.type === "text" ? (m.raw += (m.raw.endsWith(`
`) ? "" : `
`) + f.raw, m.text += `
` + f.raw, this.inlineQueue.at(-1).src = m.text) : (this.tokens.links[f.tag] || (this.tokens.links[f.tag] = { href: f.href, title: f.title }), s.push(f));
        continue;
      }
      if (f = this.tokenizer.table(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      if (f = this.tokenizer.lheading(a)) {
        a = a.substring(f.raw.length), s.push(f);
        continue;
      }
      let h = a;
      if (this.options.extensions?.startBlock) {
        let m = 1 / 0, v = a.slice(1), y;
        this.options.extensions.startBlock.forEach((g) => {
          y = g.call({ lexer: this }, v), typeof y == "number" && y >= 0 && (m = Math.min(m, y));
        }), m < 1 / 0 && m >= 0 && (h = a.substring(0, m + 1));
      }
      if (this.state.top && (f = this.tokenizer.paragraph(h))) {
        let m = s.at(-1);
        r && m?.type === "paragraph" ? (m.raw += (m.raw.endsWith(`
`) ? "" : `
`) + f.raw, m.text += `
` + f.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = m.text) : s.push(f), r = h.length !== a.length, a = a.substring(f.raw.length);
        continue;
      }
      if (f = this.tokenizer.text(a)) {
        a = a.substring(f.raw.length);
        let m = s.at(-1);
        m?.type === "text" ? (m.raw += (m.raw.endsWith(`
`) ? "" : `
`) + f.raw, m.text += `
` + f.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = m.text) : s.push(f);
        continue;
      }
      if (a) {
        this.infiniteLoopError(a.charCodeAt(0));
        break;
      }
    }
    return this.state.top = !0, s;
  }
  inline(a, s = []) {
    return this.inlineQueue.push({ src: a, tokens: s }), s;
  }
  linkInText(a) {
    if (!a.includes("[")) return !1;
    let s = this.tokenizer.rules.inline.link;
    for (let r of a.matchAll(this.tokenizer.rules.inline.blockSkip)) if (s.test(r[0]) && a.charAt(r.index - 1) !== "!") return !0;
    for (let r of a.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      let o = r[0], f = o.lastIndexOf("[");
      if (!(o.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, Vf(o.slice(f + 1, -1)))) && !(f > 1 && this.linkInText(o.slice(1, f - 1)))) return !0;
    }
    return !1;
  }
  inlineTokens(a, s = []) {
    this.tokenizer.lexer = this;
    let r = this.state.linkParenPossible;
    this.state.linkParenPossible = r && a.includes(")");
    try {
      return this.#e(a, s);
    } finally {
      this.state.linkParenPossible = r;
    }
  }
  #e(a, s) {
    let r = a.includes("*") || a.includes("_") || a.includes("~") || this.options.hooks?.emStrongMask || this.tokenizer.emStrong !== ao.prototype.emStrong || this.tokenizer.del !== ao.prototype.del ? this.#n(a) : a;
    Qj(this.tokenizer, r);
    try {
      return this.#t(a, r, s);
    } finally {
      Kj(this.tokenizer);
    }
  }
  #t(a, s, r) {
    let o = !1, f = "", h = 1 / 0;
    for (; a; ) {
      if (a.length < h) h = a.length;
      else {
        this.infiniteLoopError(a.charCodeAt(0));
        break;
      }
      o || (f = ""), o = !1;
      let m;
      if (this.options.extensions?.inline?.some((y) => (m = y.call({ lexer: this }, a, r)) ? (a = a.substring(m.raw.length), r.push(m), !0) : !1)) continue;
      if (m = this.tokenizer.escape(a)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.tag(a)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.link(a)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.reflink(a, this.tokens.links)) {
        a = a.substring(m.raw.length);
        let y = r.at(-1);
        m.type === "text" && y?.type === "text" ? (y.raw += m.raw, y.text += m.text) : r.push(m);
        continue;
      }
      if (m = this.tokenizer.emStrong(a, s, f)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.codespan(a)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.br(a)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.del(a, s, f)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (m = this.tokenizer.autolink(a)) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      if (!this.state.inLink && (m = this.tokenizer.url(a))) {
        a = a.substring(m.raw.length), r.push(m);
        continue;
      }
      let v = a;
      if (this.options.extensions?.startInline) {
        let y = 1 / 0, g = a.slice(1), p;
        this.options.extensions.startInline.forEach((S) => {
          p = S.call({ lexer: this }, g), typeof p == "number" && p >= 0 && (y = Math.min(y, p));
        }), y < 1 / 0 && y >= 0 && (v = a.substring(0, y + 1));
      }
      if (m = this.tokenizer.inlineText(v)) {
        a = a.substring(m.raw.length), m.raw.slice(-1) !== "_" && (f = m.raw.slice(-1)), o = !0;
        let y = r.at(-1);
        y?.type === "text" ? (y.raw += m.raw, y.text += m.text) : r.push(m);
        continue;
      }
      if (a) {
        this.infiniteLoopError(a.charCodeAt(0));
        break;
      }
    }
    return r;
  }
  #n(a) {
    let s = a;
    if (this.tokens.links && a.includes("[")) {
      let r = this.tokenizer.rules.inline.reflinkSearch, o = (f) => {
        let h = f.lastIndexOf("[");
        if (!Object.hasOwn(this.tokens.links, Vf(f.slice(h + 1, -1)))) return f;
        if (h > 1 && f.charAt(0) !== "!") {
          let m = f.slice(1, h - 1);
          if (this.linkInText(m)) return "[" + m.replace(r, o) + "][" + "a".repeat(f.length - h - 2) + "]";
        }
        return "[" + "a".repeat(f.length - 2) + "]";
      };
      s = s.replace(r, o);
    }
    return s = s.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (r, o, f) => f ? "+".repeat(r.length) : o ? o + r.slice(o.length, -o.length).replace(/`/g, "+") + o : r), s = s.replace(this.tokenizer.rules.inline.blockSkip, (r, o, f) => {
      let h = f ? f.length : 0;
      return r.slice(0, h) + "[" + "a".repeat(r.length - h - 2) + "]";
    }), s = this.options.hooks?.emStrongMask?.call({ lexer: this }, s) ?? s, s;
  }
  infiniteLoopError(a) {
    let s = "Infinite loop on byte: " + a;
    if (this.options.silent) console.error(s);
    else throw new Error(s);
  }
}, Yf = class {
  options;
  parser;
  constructor(n) {
    this.options = n || sr;
  }
  space(n) {
    return "";
  }
  code({ text: n, lang: a, escaped: s }) {
    let r = (a || "").match(Hn.notSpaceStart)?.[0], o = n ? n.replace(Hn.endingNewline, "") + `
` : "";
    return r ? '<pre><code class="language-' + Pi(r) + '">' + (s ? o : Pi(o, !0)) + `</code></pre>
` : "<pre><code>" + (s ? o : Pi(o, !0)) + `</code></pre>
`;
  }
  blockquote({ tokens: n }) {
    return `<blockquote>
${this.parser.parse(n)}</blockquote>
`;
  }
  html({ text: n }) {
    return n;
  }
  def(n) {
    return "";
  }
  heading({ tokens: n, depth: a }) {
    return `<h${a}>${this.parser.parseInline(n)}</h${a}>
`;
  }
  hr(n) {
    return `<hr>
`;
  }
  list(n) {
    let a = n.ordered, s = n.start, r = "";
    for (let h = 0; h < n.items.length; h++) {
      let m = n.items[h];
      r += this.listitem(m);
    }
    let o = a ? "ol" : "ul", f = a && s !== 1 ? ' start="' + s + '"' : "";
    return "<" + o + f + `>
` + r + "</" + o + `>
`;
  }
  listitem(n) {
    return `<li>${this.parser.parse(n.tokens)}</li>
`;
  }
  checkbox({ checked: n }) {
    return "<input " + (n ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: n }) {
    return `<p>${this.parser.parseInline(n)}</p>
`;
  }
  table(n) {
    let a = "", s = "";
    for (let o = 0; o < n.header.length; o++) s += this.tablecell(n.header[o]);
    a += this.tablerow({ text: s });
    let r = "";
    for (let o = 0; o < n.rows.length; o++) {
      let f = n.rows[o];
      s = "";
      for (let h = 0; h < f.length; h++) s += this.tablecell(f[h]);
      r += this.tablerow({ text: s });
    }
    return r && (r = `<tbody>${r}</tbody>`), `<table>
<thead>
` + a + `</thead>
` + r + `</table>
`;
  }
  tablerow({ text: n }) {
    return `<tr>
${n}</tr>
`;
  }
  tablecell(n) {
    let a = this.parser.parseInline(n.tokens), s = n.header ? "th" : "td";
    return (n.align ? `<${s} align="${n.align}">` : `<${s}>`) + a + `</${s}>
`;
  }
  strong({ tokens: n }) {
    return `<strong>${this.parser.parseInline(n)}</strong>`;
  }
  em({ tokens: n }) {
    return `<em>${this.parser.parseInline(n)}</em>`;
  }
  codespan({ text: n }) {
    return `<code>${Pi(n, !0)}</code>`;
  }
  br(n) {
    return "<br>";
  }
  del({ tokens: n }) {
    return `<del>${this.parser.parseInline(n)}</del>`;
  }
  link({ href: n, title: a, text: s, tokens: r, autolink: o }) {
    let f = o ? Pi(s, !0) : this.parser.parseInline(r), h = U1(n);
    if (h === null) return f;
    n = Pi(h, o);
    let m = '<a href="' + n + '"';
    return a && (m += ' title="' + Pi(a) + '"'), m += ">" + f + "</a>", m;
  }
  image({ href: n, title: a, text: s, tokens: r }) {
    r && (s = this.parser.parseInline(r, this.parser.textRenderer));
    let o = U1(n);
    if (o === null) return Pi(s);
    n = o;
    let f = `<img src="${Pi(n)}" alt="${Pi(s)}"`;
    return a && (f += ` title="${Pi(a)}"`), f += ">", f;
  }
  text(n) {
    return "tokens" in n && n.tokens ? this.parser.parseInline(n.tokens) : "escaped" in n && n.escaped ? n.text : Pi(n.text);
  }
}, rg = class {
  parser;
  strong({ text: n, tokens: a }) {
    return a ? this.parser.parseInline(a, this) : n;
  }
  em({ text: n, tokens: a }) {
    return a ? this.parser.parseInline(a, this) : n;
  }
  codespan({ text: n }) {
    return n;
  }
  del({ text: n, tokens: a }) {
    return a ? this.parser.parseInline(a, this) : n;
  }
  html({ text: n }) {
    return n;
  }
  text({ text: n }) {
    return n;
  }
  link({ text: n, tokens: a }) {
    return a ? this.parser.parseInline(a, this) : n;
  }
  image({ text: n, tokens: a }) {
    return a ? this.parser.parseInline(a, this) : n;
  }
  br() {
    return "";
  }
  checkbox({ raw: n }) {
    return n;
  }
}, Ra = class Ep {
  options;
  renderer;
  textRenderer;
  constructor(a) {
    this.options = a || sr, this.options.renderer = this.options.renderer || new Yf(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new rg(), this.textRenderer.parser = this;
  }
  static parse(a, s) {
    return new Ep(s).parse(a);
  }
  static parseInline(a, s) {
    return new Ep(s).parseInline(a);
  }
  parse(a) {
    this.renderer.parser = this;
    let s = "";
    for (let r = 0; r < a.length; r++) {
      let o = a[r];
      if (this.options.extensions?.renderers?.[o.type]) {
        let h = o, m = this.options.extensions.renderers[h.type].call({ parser: this }, h);
        if (m !== !1 || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(h.type)) {
          s += m || "";
          continue;
        }
      }
      let f = o;
      switch (f.type) {
        case "space": {
          s += this.renderer.space(f);
          break;
        }
        case "hr": {
          s += this.renderer.hr(f);
          break;
        }
        case "heading": {
          s += this.renderer.heading(f);
          break;
        }
        case "code": {
          s += this.renderer.code(f);
          break;
        }
        case "table": {
          s += this.renderer.table(f);
          break;
        }
        case "blockquote": {
          s += this.renderer.blockquote(f);
          break;
        }
        case "list": {
          s += this.renderer.list(f);
          break;
        }
        case "checkbox": {
          s += this.renderer.checkbox(f);
          break;
        }
        case "html": {
          s += this.renderer.html(f);
          break;
        }
        case "def": {
          s += this.renderer.def(f);
          break;
        }
        case "paragraph": {
          s += this.renderer.paragraph(f);
          break;
        }
        case "text": {
          s += this.renderer.text(f);
          break;
        }
        default: {
          let h = 'Token with "' + f.type + '" type was not found.';
          if (this.options.silent) return console.error(h), "";
          throw new Error(h);
        }
      }
    }
    return s;
  }
  parseInline(a, s = this.renderer) {
    this.renderer.parser = this;
    let r = "";
    for (let o = 0; o < a.length; o++) {
      let f = a[o];
      if (this.options.extensions?.renderers?.[f.type]) {
        let m = this.options.extensions.renderers[f.type].call({ parser: this }, f);
        if (m !== !1 || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(f.type)) {
          r += m || "";
          continue;
        }
      }
      let h = f;
      switch (h.type) {
        case "escape": {
          r += s.text(h);
          break;
        }
        case "html": {
          r += s.html(h);
          break;
        }
        case "link": {
          r += s.link(h);
          break;
        }
        case "image": {
          r += s.image(h);
          break;
        }
        case "checkbox": {
          r += s.checkbox(h);
          break;
        }
        case "strong": {
          r += s.strong(h);
          break;
        }
        case "em": {
          r += s.em(h);
          break;
        }
        case "codespan": {
          r += s.codespan(h);
          break;
        }
        case "br": {
          r += s.br(h);
          break;
        }
        case "del": {
          r += s.del(h);
          break;
        }
        case "text": {
          r += s.text(h);
          break;
        }
        default: {
          let m = 'Token with "' + h.type + '" type was not found.';
          if (this.options.silent) return console.error(m), "";
          throw new Error(m);
        }
      }
    }
    return r;
  }
}, Sc = class {
  options;
  block;
  constructor(n) {
    this.options = n || sr;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(n) {
    return n;
  }
  postprocess(n) {
    return n;
  }
  processAllTokens(n) {
    return n;
  }
  emStrongMask(n) {
    return n;
  }
  provideLexer(n = this.block) {
    return n ? ja.lex : ja.lexInline;
  }
  provideParser(n = this.block) {
    return n ? Ra.parse : Ra.parseInline;
  }
};
function fs(n, a) {
  if (Array.isArray(a)) for (let s = 0; s < a.length; s++) n.push(a[s]);
  else n.push(a);
}
var Wj = class {
  defaults = Wp();
  options = this.setOptions;
  parse = this.parseMarkdown(!0);
  parseInline = this.parseMarkdown(!1);
  Parser = Ra;
  Renderer = Yf;
  TextRenderer = rg;
  Lexer = ja;
  Tokenizer = ao;
  Hooks = Sc;
  constructor(...n) {
    this.use(...n);
  }
  walkTokens(n, a) {
    let s = [];
    for (let r of n) switch (fs(s, a.call(this, r)), r.type) {
      case "table": {
        let o = r;
        for (let f of o.header) fs(s, this.walkTokens(f.tokens, a));
        for (let f of o.rows) for (let h of f) fs(s, this.walkTokens(h.tokens, a));
        break;
      }
      case "list": {
        let o = r;
        fs(s, this.walkTokens(o.items, a));
        break;
      }
      default: {
        let o = r;
        this.defaults.extensions?.childTokens?.[o.type] ? this.defaults.extensions.childTokens[o.type].forEach((f) => {
          let h = o[f].flat(1 / 0);
          fs(s, this.walkTokens(h, a));
        }) : o.tokens && fs(s, this.walkTokens(o.tokens, a));
      }
    }
    return s;
  }
  use(...n) {
    let a = this.defaults.extensions || { renderers: /* @__PURE__ */ Object.create(null), childTokens: /* @__PURE__ */ Object.create(null) };
    return n.forEach((s) => {
      let r = { ...s };
      if (r.async = this.defaults.async || r.async || !1, s.extensions && (s.extensions.forEach((o) => {
        if (!o.name) throw new Error("extension name required");
        if ("renderer" in o) {
          let f = a.renderers[o.name];
          f ? a.renderers[o.name] = function(...h) {
            let m = o.renderer.apply(this, h);
            return m === !1 && (m = f.apply(this, h)), m;
          } : a.renderers[o.name] = o.renderer;
        }
        if ("tokenizer" in o) {
          if (!o.level || o.level !== "block" && o.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let f = a[o.level];
          f ? f.unshift(o.tokenizer) : a[o.level] = [o.tokenizer], o.start && (o.level === "block" ? a.startBlock ? a.startBlock.push(o.start) : a.startBlock = [o.start] : o.level === "inline" && (a.startInline ? a.startInline.push(o.start) : a.startInline = [o.start]));
        }
        "childTokens" in o && o.childTokens && (a.childTokens[o.name] = o.childTokens);
      }), r.extensions = a), s.renderer) {
        let o = this.defaults.renderer || new Yf(this.defaults);
        for (let f in s.renderer) {
          if (!(f in o)) throw new Error(`renderer '${f}' does not exist`);
          if (["options", "parser"].includes(f)) continue;
          let h = f, m = s.renderer[h], v = o[h];
          o[h] = (...y) => {
            let g = m.apply(o, y);
            return g === !1 && (g = v.apply(o, y)), g === !1 ? "" : g ?? "";
          };
        }
        r.renderer = o;
      }
      if (s.tokenizer) {
        let o = this.defaults.tokenizer || new ao(this.defaults);
        for (let f in s.tokenizer) {
          if (!(f in o)) throw new Error(`tokenizer '${f}' does not exist`);
          if (["options", "rules", "lexer"].includes(f)) continue;
          let h = f, m = s.tokenizer[h], v = o[h];
          o[h] = (...y) => {
            let g = m.apply(o, y);
            return g === !1 && (g = v.apply(o, y)), g;
          };
        }
        r.tokenizer = o;
      }
      if (s.hooks) {
        let o = this.defaults.hooks || new Sc();
        for (let f in s.hooks) {
          if (!(f in o)) throw new Error(`hook '${f}' does not exist`);
          if (["options", "block"].includes(f)) continue;
          let h = f, m = s.hooks[h], v = o[h];
          Sc.passThroughHooks.has(f) ? o[h] = (y) => {
            if (o.options.async && Sc.passThroughHooksRespectAsync.has(f)) return (async () => {
              let p = await m.call(o, y);
              return v.call(o, p);
            })();
            let g = m.call(o, y);
            return v.call(o, g);
          } : o[h] = (...y) => {
            if (o.options.async) return (async () => {
              let p = await m.apply(o, y);
              return p === !1 && (p = await v.apply(o, y)), p;
            })();
            let g = m.apply(o, y);
            return g === !1 && (g = v.apply(o, y)), g;
          };
        }
        r.hooks = o;
      }
      if (s.walkTokens) {
        let o = this.defaults.walkTokens, f = s.walkTokens;
        r.walkTokens = function(h) {
          let m = [];
          return fs(m, f.call(this, h)), o && fs(m, o.call(this, h)), m;
        };
      }
      this.defaults = { ...this.defaults, ...r };
    }), this;
  }
  setOptions(n) {
    return this.defaults = { ...this.defaults, ...n }, this;
  }
  lexer(n, a) {
    return ja.lex(n, a ?? this.defaults);
  }
  parser(n, a) {
    return Ra.parse(n, a ?? this.defaults);
  }
  parseMarkdown(n) {
    return (a, s) => {
      let r = { ...s }, o = { ...this.defaults, ...r }, f = this.onError(!!o.silent, !!o.async);
      if (this.defaults.async === !0 && r.async === !1) return f(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof a > "u" || a === null) return f(new Error("marked(): input parameter is undefined or null"));
      if (typeof a != "string") return f(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(a) + ", string expected"));
      if (o.hooks && (o.hooks.options = o, o.hooks.block = n), o.async) return (async () => {
        let h = o.hooks ? await o.hooks.preprocess(a) : a, m = await (o.hooks ? await o.hooks.provideLexer(n) : n ? ja.lex : ja.lexInline)(h, o), v = o.hooks ? await o.hooks.processAllTokens(m) : m;
        o.walkTokens && await Promise.all(this.walkTokens(v, o.walkTokens));
        let y = await (o.hooks ? await o.hooks.provideParser(n) : n ? Ra.parse : Ra.parseInline)(v, o);
        return o.hooks ? await o.hooks.postprocess(y) : y;
      })().catch(f);
      try {
        o.hooks && (a = o.hooks.preprocess(a));
        let h = (o.hooks ? o.hooks.provideLexer(n) : n ? ja.lex : ja.lexInline)(a, o);
        o.hooks && (h = o.hooks.processAllTokens(h)), o.walkTokens && this.walkTokens(h, o.walkTokens);
        let m = (o.hooks ? o.hooks.provideParser(n) : n ? Ra.parse : Ra.parseInline)(h, o);
        return o.hooks && (m = o.hooks.postprocess(m)), m;
      } catch (h) {
        return f(h);
      }
    };
  }
  onError(n, a) {
    return (s) => {
      if (s.message += `
Please report this to https://github.com/markedjs/marked.`, n) {
        let r = "<p>An error occurred:</p><pre>" + Pi(s.message + "", !0) + "</pre>";
        return a ? Promise.resolve(r) : r;
      }
      if (a) return Promise.reject(s);
      throw s;
    };
  }
}, lr = new Wj();
function Ht(n, a) {
  return lr.parse(n, a);
}
Ht.options = Ht.setOptions = function(n) {
  return lr.setOptions(n), Ht.defaults = lr.defaults, vw(Ht.defaults), Ht;
};
Ht.getDefaults = Wp;
Ht.defaults = sr;
function e4(...n) {
  return lr.use(...n), Ht.defaults = lr.defaults, vw(Ht.defaults), Ht;
}
Ht.use = e4;
Ht.walkTokens = function(n, a) {
  return lr.walkTokens(n, a);
};
Ht.parseInline = lr.parseInline;
Ht.Parser = Ra;
Ht.parser = Ra.parse;
Ht.Renderer = Yf;
Ht.TextRenderer = rg;
Ht.Lexer = ja;
Ht.lexer = ja.lex;
Ht.Tokenizer = ao;
Ht.Hooks = Sc;
Ht.parse = Ht;
Ht.options;
Ht.setOptions;
Ht.walkTokens;
Ht.parseInline;
Ra.parse;
ja.lex;
function I1(n, a) {
  (a == null || a > n.length) && (a = n.length);
  for (var s = 0, r = Array(a); s < a; s++) r[s] = n[s];
  return r;
}
function t4(n) {
  if (Array.isArray(n)) return n;
}
function n4(n, a) {
  var s = n == null ? null : typeof Symbol < "u" && n[Symbol.iterator] || n["@@iterator"];
  if (s != null) {
    var r, o, f, h, m = [], v = !0, y = !1;
    try {
      if (f = (s = s.call(n)).next, a !== 0) for (; !(v = (r = f.call(s)).done) && (m.push(r.value), m.length !== a); v = !0) ;
    } catch (g) {
      y = !0, o = g;
    } finally {
      try {
        if (!v && s.return != null && (h = s.return(), Object(h) !== h)) return;
      } finally {
        if (y) throw o;
      }
    }
    return m;
  }
}
function i4() {
  throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
}
function a4(n, a) {
  return t4(n) || n4(n, a) || l4(n, a) || i4();
}
function l4(n, a) {
  if (n) {
    if (typeof n == "string") return I1(n, a);
    var s = {}.toString.call(n).slice(8, -1);
    return s === "Object" && n.constructor && (s = n.constructor.name), s === "Map" || s === "Set" ? Array.from(n) : s === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(s) ? I1(n, a) : void 0;
  }
}
const Aw = Object.entries, X1 = Object.setPrototypeOf, s4 = Object.isFrozen, Mw = Object.getPrototypeOf, zw = Object.getOwnPropertyDescriptor;
let Zn = Object.freeze, si = Object.seal, Kr = Object.create, kw = typeof Reflect < "u" && Reflect, Np = kw.apply, Tp = kw.construct;
Zn || (Zn = function(a) {
  return a;
});
si || (si = function(a) {
  return a;
});
Np || (Np = function(a, s) {
  for (var r = arguments.length, o = new Array(r > 2 ? r - 2 : 0), f = 2; f < r; f++) o[f - 2] = arguments[f];
  return a.apply(s, o);
});
Tp || (Tp = function(a) {
  for (var s = arguments.length, r = new Array(s > 1 ? s - 1 : 0), o = 1; o < s; o++) r[o - 1] = arguments[o];
  return new a(...r);
});
const Ml = Ft(Array.prototype.forEach), r4 = Ft(Array.prototype.lastIndexOf), G1 = Ft(Array.prototype.pop), dc = Ft(Array.prototype.push), o4 = Ft(Array.prototype.slice), c4 = Ft(Array.prototype.splice), lo = Array.isArray, Im = jw(Set), Xm = Ft(Set.prototype.add), hc = Ft(Set.prototype.has), Is = Ft(String.prototype.toLowerCase), Gm = Ft(String.prototype.toString), Z1 = Ft(String.prototype.match), mc = Ft(String.prototype.replace), Q1 = Ft(String.prototype.indexOf), u4 = Ft(String.prototype.trim), f4 = Ft(Number.prototype.toString), d4 = Ft(Boolean.prototype.toString), K1 = typeof BigInt > "u" ? null : Ft(BigInt.prototype.toString), P1 = typeof Symbol > "u" ? null : Ft(Symbol.prototype.toString), Hi = Ft(Object.prototype.hasOwnProperty), pc = Ft(Object.prototype.toString), li = Ft(RegExp.prototype.test), zl = jw(TypeError);
function Ft(n) {
  return function(a) {
    a instanceof RegExp && (a.lastIndex = 0);
    for (var s = arguments.length, r = new Array(s > 1 ? s - 1 : 0), o = 1; o < s; o++) r[o - 1] = arguments[o];
    return Np(n, a, r);
  };
}
function jw(n) {
  return function() {
    for (var a = arguments.length, s = new Array(a), r = 0; r < a; r++) s[r] = arguments[r];
    return Tp(n, s);
  };
}
function xt(n, a) {
  let s = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : Is;
  if (X1 && X1(n, null), !lo(a)) return n;
  let r = a.length;
  for (; r--; ) {
    let o = a[r];
    if (typeof o == "string") {
      const f = s(o);
      f !== o && (s4(a) || (a[r] = f), o = f);
    }
    n[o] = !0;
  }
  return n;
}
function h4(n) {
  for (let a = 0; a < n.length; a++) Hi(n, a) || (n[a] = null);
  return n;
}
function Ji(n) {
  const a = Kr(null);
  for (const r of Aw(n)) {
    var s = a4(r, 2);
    const o = s[0], f = s[1];
    Hi(n, o) && (lo(f) ? a[o] = h4(f) : f && typeof f == "object" && f.constructor === Object ? a[o] = Ji(f) : a[o] = f);
  }
  return a;
}
function m4(n) {
  switch (typeof n) {
    case "string":
      return n;
    case "number":
      return f4(n);
    case "boolean":
      return d4(n);
    case "bigint":
      return K1 ? K1(n) : "0";
    case "symbol":
      return P1 ? P1(n) : "Symbol()";
    case "undefined":
      return pc(n);
    case "function":
    case "object": {
      if (n === null) return pc(n);
      const a = n, s = pa(a, "toString");
      if (typeof s == "function") {
        const r = s(a);
        return typeof r == "string" ? r : pc(r);
      }
      return pc(n);
    }
    default:
      return pc(n);
  }
}
function pa(n, a) {
  for (; n !== null; ) {
    const r = zw(n, a);
    if (r) {
      if (r.get) return Ft(r.get);
      if (typeof r.value == "function") return Ft(r.value);
    }
    n = Mw(n);
  }
  function s() {
    return null;
  }
  return s;
}
function p4(n, a) {
  for (; n !== null; ) {
    const s = zw(n, a);
    if (s) return s.get ? Ft(s.get) : null;
    n = Mw(n);
  }
  return null;
}
function g4(n) {
  try {
    return li(n, ""), !0;
  } catch {
    return !1;
  }
}
const J1 = Zn([
  "a",
  "abbr",
  "acronym",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "blink",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "content",
  "data",
  "datalist",
  "dd",
  "decorator",
  "del",
  "details",
  "dfn",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "element",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "font",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "map",
  "mark",
  "marquee",
  "menu",
  "menuitem",
  "meter",
  "nav",
  "nobr",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "select",
  "shadow",
  "slot",
  "small",
  "source",
  "spacer",
  "span",
  "strike",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "tt",
  "u",
  "ul",
  "var",
  "video",
  "wbr"
]), Zm = Zn([
  "svg",
  "a",
  "altglyph",
  "altglyphdef",
  "altglyphitem",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "enterkeyhint",
  "exportparts",
  "filter",
  "font",
  "g",
  "glyph",
  "glyphref",
  "hkern",
  "image",
  "inputmode",
  "line",
  "lineargradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "part",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "style",
  "switch",
  "symbol",
  "text",
  "textpath",
  "title",
  "tref",
  "tspan",
  "view",
  "vkern"
]), Qm = Zn([
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence"
]), y4 = Zn([
  "animate",
  "color-profile",
  "cursor",
  "discard",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignobject",
  "hatch",
  "hatchpath",
  "mesh",
  "meshgradient",
  "meshpatch",
  "meshrow",
  "missing-glyph",
  "script",
  "set",
  "solidcolor",
  "unknown",
  "use"
]), Km = Zn([
  "math",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msup",
  "msubsup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "mprescripts"
]), v4 = Zn([
  "maction",
  "maligngroup",
  "malignmark",
  "mlongdiv",
  "mscarries",
  "mscarry",
  "msgroup",
  "mstack",
  "msline",
  "msrow",
  "semantics",
  "annotation",
  "annotation-xml",
  "mprescripts",
  "none"
]), F1 = Zn(["#text"]), W1 = Zn([
  "accept",
  "action",
  "align",
  "alt",
  "autocapitalize",
  "autocomplete",
  "autopictureinpicture",
  "autoplay",
  "background",
  "bgcolor",
  "border",
  "capture",
  "cellpadding",
  "cellspacing",
  "checked",
  "cite",
  "class",
  "clear",
  "color",
  "cols",
  "colspan",
  "command",
  "commandfor",
  "controls",
  "controlslist",
  "coords",
  "crossorigin",
  "datetime",
  "decoding",
  "default",
  "dir",
  "disabled",
  "disablepictureinpicture",
  "disableremoteplayback",
  "download",
  "draggable",
  "enctype",
  "enterkeyhint",
  "exportparts",
  "face",
  "for",
  "headers",
  "height",
  "hidden",
  "high",
  "href",
  "hreflang",
  "id",
  "inert",
  "inputmode",
  "integrity",
  "ismap",
  "kind",
  "label",
  "lang",
  "list",
  "loading",
  "loop",
  "low",
  "max",
  "maxlength",
  "media",
  "method",
  "min",
  "minlength",
  "multiple",
  "muted",
  "name",
  "nonce",
  "noshade",
  "novalidate",
  "nowrap",
  "open",
  "optimum",
  "part",
  "pattern",
  "placeholder",
  "playsinline",
  "popover",
  "popovertarget",
  "popovertargetaction",
  "poster",
  "preload",
  "pubdate",
  "radiogroup",
  "readonly",
  "rel",
  "required",
  "rev",
  "reversed",
  "role",
  "rows",
  "rowspan",
  "spellcheck",
  "scope",
  "selected",
  "shape",
  "size",
  "sizes",
  "slot",
  "span",
  "srclang",
  "start",
  "src",
  "srcset",
  "step",
  "style",
  "summary",
  "tabindex",
  "title",
  "translate",
  "type",
  "usemap",
  "valign",
  "value",
  "width",
  "wrap",
  "xmlns"
]), Pm = Zn([
  "accent-height",
  "accumulate",
  "additive",
  "alignment-baseline",
  "amplitude",
  "ascent",
  "attributename",
  "attributetype",
  "azimuth",
  "basefrequency",
  "baseline-shift",
  "begin",
  "bias",
  "by",
  "class",
  "clip",
  "clippathunits",
  "clip-path",
  "clip-rule",
  "color",
  "color-interpolation",
  "color-interpolation-filters",
  "color-profile",
  "color-rendering",
  "cx",
  "cy",
  "d",
  "dx",
  "dy",
  "diffuseconstant",
  "direction",
  "display",
  "divisor",
  "dominant-baseline",
  "dur",
  "edgemode",
  "elevation",
  "end",
  "exponent",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "filterunits",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "fx",
  "fy",
  "g1",
  "g2",
  "glyph-name",
  "glyphref",
  "gradientunits",
  "gradienttransform",
  "height",
  "href",
  "id",
  "image-rendering",
  "in",
  "in2",
  "intercept",
  "k",
  "k1",
  "k2",
  "k3",
  "k4",
  "kerning",
  "keypoints",
  "keysplines",
  "keytimes",
  "lang",
  "lengthadjust",
  "letter-spacing",
  "kernelmatrix",
  "kernelunitlength",
  "lighting-color",
  "local",
  "marker-end",
  "marker-mid",
  "marker-start",
  "markerheight",
  "markerunits",
  "markerwidth",
  "maskcontentunits",
  "maskunits",
  "max",
  "mask",
  "mask-type",
  "media",
  "method",
  "mode",
  "min",
  "name",
  "numoctaves",
  "offset",
  "operator",
  "opacity",
  "order",
  "orient",
  "orientation",
  "origin",
  "overflow",
  "paint-order",
  "path",
  "pathlength",
  "patterncontentunits",
  "patterntransform",
  "patternunits",
  "pointer-events",
  "points",
  "preservealpha",
  "preserveaspectratio",
  "primitiveunits",
  "r",
  "rx",
  "ry",
  "radius",
  "refx",
  "refy",
  "repeatcount",
  "repeatdur",
  "restart",
  "result",
  "rotate",
  "scale",
  "seed",
  "shape-rendering",
  "slope",
  "specularconstant",
  "specularexponent",
  "spreadmethod",
  "startoffset",
  "stddeviation",
  "stitchtiles",
  "stop-color",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke",
  "stroke-width",
  "style",
  "surfacescale",
  "systemlanguage",
  "tabindex",
  "tablevalues",
  "targetx",
  "targety",
  "transform",
  "transform-origin",
  "text-anchor",
  "text-decoration",
  "text-orientation",
  "text-rendering",
  "textlength",
  "type",
  "u1",
  "u2",
  "unicode",
  "values",
  "vector-effect",
  "viewbox",
  "visibility",
  "version",
  "vert-adv-y",
  "vert-origin-x",
  "vert-origin-y",
  "width",
  "word-spacing",
  "wrap",
  "writing-mode",
  "xchannelselector",
  "ychannelselector",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
  "z",
  "zoomandpan"
]), eb = Zn([
  "accent",
  "accentunder",
  "align",
  "bevelled",
  "close",
  "columnalign",
  "columnlines",
  "columnspacing",
  "columnspan",
  "denomalign",
  "depth",
  "dir",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "frame",
  "height",
  "href",
  "id",
  "largeop",
  "length",
  "linethickness",
  "lquote",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "numalign",
  "open",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rowspan",
  "rspace",
  "rquote",
  "scriptlevel",
  "scriptminsize",
  "scriptsizemultiplier",
  "selection",
  "separator",
  "separators",
  "stretchy",
  "subscriptshift",
  "supscriptshift",
  "symmetric",
  "voffset",
  "width",
  "xmlns"
]), vf = Zn([
  "xlink:href",
  "xml:id",
  "xlink:title",
  "xml:space",
  "xmlns:xlink"
]), x4 = si(/{{[\w\W]*|^[\w\W]*}}/g), b4 = si(/<%[\w\W]*|^[\w\W]*%>/g), S4 = si(/\${[\w\W]*/g), w4 = si(/^data-[\-\w.\u00B7-\uFFFF]+$/), _4 = si(/^aria-[\-\w]+$/), tb = si(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i), E4 = si(/^(?:\w+script|data):/i), N4 = si(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g), T4 = si(/^html$/i), C4 = si(/^[a-z][.\w]*(-[.\w]+)+$/i), Jm = si(/<[/\w!]/g), nb = si(/<[/\w]/g), A4 = si(/<\/no(script|embed|frames)/i), ib = si(/\/>/i), Cn = {
  element: 1,
  attribute: 2,
  text: 3,
  cdataSection: 4,
  entityReference: 5,
  entityNode: 6,
  processingInstruction: 7,
  comment: 8,
  document: 9,
  documentType: 10,
  documentFragment: 11,
  notation: 12
}, M4 = Zn(xt({}, [
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript"
])), z4 = function() {
  return typeof window > "u" ? null : window;
}, k4 = function(a, s) {
  if (typeof a != "object" || typeof a.createPolicy != "function") return null;
  let r = null;
  const o = "data-tt-policy-suffix";
  s && s.hasAttribute(o) && (r = s.getAttribute(o));
  const f = "dompurify" + (r ? "#" + r : "");
  try {
    return a.createPolicy(f, {
      createHTML(h) {
        return h;
      },
      createScriptURL(h) {
        return h;
      }
    });
  } catch {
    return console.warn("TrustedTypes policy " + f + " could not be created."), null;
  }
}, ab = function() {
  return {
    afterSanitizeAttributes: [],
    afterSanitizeElements: [],
    afterSanitizeShadowDOM: [],
    beforeSanitizeAttributes: [],
    beforeSanitizeElements: [],
    beforeSanitizeShadowDOM: [],
    uponSanitizeAttribute: [],
    uponSanitizeElement: [],
    uponSanitizeShadowNode: []
  };
}, ds = function(a, s, r, o) {
  return Hi(a, s) && lo(a[s]) ? xt(o.base ? Ji(o.base) : {}, a[s], o.transform) : r;
}, Fm = function(a, s, r) {
  const o = Hi(a, s) ? a[s] : void 0;
  return o && typeof o == "object" ? Ji(o) : r();
};
function Rw() {
  let n = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : z4();
  const a = (xe) => Rw(xe);
  if (a.version = "3.4.17", a.removed = [], !n || !n.document || n.document.nodeType !== Cn.document || !n.Element)
    return a.isSupported = !1, a;
  let s = n.document;
  const r = s, o = r.currentScript;
  n.DocumentFragment;
  const f = n.HTMLTemplateElement, h = n.Node, m = n.Element, v = n.NodeFilter;
  n.NamedNodeMap === void 0 && (n.NamedNodeMap || n.MozNamedAttrMap), n.HTMLFormElement;
  const y = n.DOMParser, g = n.trustedTypes, p = m.prototype, S = pa(p, "cloneNode"), w = pa(p, "remove"), E = pa(p, "removeAttributeNode"), N = pa(p, "nextSibling"), _ = pa(p, "childNodes"), C = pa(p, "parentNode"), D = pa(p, "shadowRoot"), M = pa(p, "attributes"), R = h && h.prototype ? pa(h.prototype, "nodeType") : null, Q = h && h.prototype ? pa(h.prototype, "nodeName") : null, V = h && h.prototype ? pa(h.prototype, "ownerDocument") : null, k = function(z) {
    return R ? R(z) : z.nodeType;
  }, H = function(z) {
    return Q ? Q(z) : z.nodeName;
  }, q = p4(p, "namespaceURI"), de = function(z) {
    return q ? q(z) : z.namespaceURI;
  };
  if (typeof f == "function") {
    const xe = s.createElement("template");
    xe.content && xe.content.ownerDocument && (s = xe.content.ownerDocument);
  }
  let ee, me = "", te, O = !1, Y = 0;
  const j = function() {
    if (Y > 0) throw zl('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.');
  }, B = function(z) {
    j(), Y++;
    try {
      return ee.createHTML(z);
    } finally {
      Y--;
    }
  }, X = function(z) {
    j(), Y++;
    try {
      return ee.createScriptURL(z);
    } finally {
      Y--;
    }
  }, J = function() {
    return O || (te = k4(g, o), O = !0), te;
  }, I = s, ae = I.implementation, he = I.createNodeIterator, Ee = I.createDocumentFragment, L = I.getElementsByTagName, ce = r.importNode;
  let pe = ab();
  a.isSupported = typeof Aw == "function" && typeof C == "function" && ae && ae.createHTMLDocument !== void 0;
  const Se = x4, le = b4, Te = S4, Ce = w4, we = _4, Ne = E4, ze = N4, Ve = C4;
  let $e = tb, Me = null;
  const Ge = xt({}, [
    ...J1,
    ...Zm,
    ...Qm,
    ...Km,
    ...F1
  ]);
  let Re = null;
  const _t = xt({}, [
    ...W1,
    ...Pm,
    ...eb,
    ...vf
  ]);
  let it = Object.seal(Kr(null, {
    tagNameCheck: {
      writable: !0,
      configurable: !1,
      enumerable: !0,
      value: null
    },
    attributeNameCheck: {
      writable: !0,
      configurable: !1,
      enumerable: !0,
      value: null
    },
    allowCustomizedBuiltInElements: {
      writable: !0,
      configurable: !1,
      enumerable: !0,
      value: !1
    }
  })), At = null, Mn = null;
  const Et = Object.seal(Kr(null, {
    tagCheck: {
      writable: !0,
      configurable: !1,
      enumerable: !0,
      value: null
    },
    attributeCheck: {
      writable: !0,
      configurable: !1,
      enumerable: !0,
      value: null
    }
  }));
  let sn = !0, It = !0, bt = !1, Nt = !0, St = !1, ft = !0, Bt = !1, gn = !1, $t = null, Qn = null, fn = !1, Gt = !1, yn = !1, Wt = !1, Li = !0, Zt = !1;
  const Tt = "user-content-";
  let vn = !0, dn = !1, Lt = null, zn = {}, Fe = null;
  const qa = xt({}, [
    "annotation-xml",
    "audio",
    "colgroup",
    "desc",
    "foreignobject",
    "head",
    "iframe",
    "math",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    "selectedcontent",
    "style",
    "svg",
    "template",
    "thead",
    "title",
    "video",
    "xmp"
  ]);
  let xn = null;
  const dt = xt({}, [
    "audio",
    "video",
    "img",
    "source",
    "image",
    "track"
  ]);
  let en = null;
  const hn = xt({}, [
    "alt",
    "class",
    "for",
    "id",
    "label",
    "name",
    "pattern",
    "placeholder",
    "role",
    "summary",
    "title",
    "value",
    "style",
    "xmlns"
  ]), Mt = "http://www.w3.org/1998/Math/MathML", ri = "http://www.w3.org/2000/svg", rn = "http://www.w3.org/1999/xhtml";
  let oe = rn, ke = !1, Ye = null;
  const K = xt({}, [
    Mt,
    ri,
    rn
  ], Gm), at = Zn([
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext"
  ]);
  let Kn = xt({}, at);
  const Qt = Zn(["annotation-xml"]);
  let tn = xt({}, Qt);
  const dl = xt({}, [
    "title",
    "style",
    "font",
    "a",
    "script"
  ]);
  let Ln = null;
  const Va = ["application/xhtml+xml", "text/html"], nn = "text/html";
  let Ot = null, gi = null;
  const Ya = s.createElement("form"), rt = function(z) {
    return z instanceof RegExp || z instanceof Function;
  }, Ui = function() {
    let z = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    if (gi && gi === z) return;
    (!z || typeof z != "object") && (z = {}), z = Ji(z), Ln = Va.indexOf(z.PARSER_MEDIA_TYPE) === -1 ? nn : z.PARSER_MEDIA_TYPE, Ot = Ln === "application/xhtml+xml" ? Gm : Is, Me = ds(z, "ALLOWED_TAGS", Ge, { transform: Ot }), Re = ds(z, "ALLOWED_ATTR", _t, { transform: Ot }), Ye = ds(z, "ALLOWED_NAMESPACES", K, { transform: Gm }), en = ds(z, "ADD_URI_SAFE_ATTR", hn, {
      transform: Ot,
      base: hn
    }), xn = ds(z, "ADD_DATA_URI_TAGS", dt, {
      transform: Ot,
      base: dt
    }), Fe = ds(z, "FORBID_CONTENTS", qa, { transform: Ot }), At = ds(z, "FORBID_TAGS", Ji({}), { transform: Ot }), Mn = ds(z, "FORBID_ATTR", Ji({}), { transform: Ot }), zn = Hi(z, "USE_PROFILES") ? z.USE_PROFILES && typeof z.USE_PROFILES == "object" ? Ji(z.USE_PROFILES) : z.USE_PROFILES : !1, sn = z.ALLOW_ARIA_ATTR !== !1, It = z.ALLOW_DATA_ATTR !== !1, bt = z.ALLOW_UNKNOWN_PROTOCOLS || !1, Nt = z.ALLOW_SELF_CLOSE_IN_ATTR !== !1, St = z.SAFE_FOR_TEMPLATES || !1, ft = z.SAFE_FOR_XML !== !1, Bt = z.WHOLE_DOCUMENT || !1, Gt = z.RETURN_DOM || !1, yn = z.RETURN_DOM_FRAGMENT || !1, Wt = z.RETURN_TRUSTED_TYPE || !1, fn = z.FORCE_BODY || !1, Li = z.SANITIZE_DOM !== !1, Zt = z.SANITIZE_NAMED_PROPS || !1, vn = z.KEEP_CONTENT !== !1, dn = z.IN_PLACE || !1, $e = g4(z.ALLOWED_URI_REGEXP) ? z.ALLOWED_URI_REGEXP : tb, oe = typeof z.NAMESPACE == "string" ? z.NAMESPACE : rn, Kn = Fm(z, "MATHML_TEXT_INTEGRATION_POINTS", () => xt({}, at)), tn = Fm(z, "HTML_INTEGRATION_POINTS", () => xt({}, Qt));
    const P = Fm(z, "CUSTOM_ELEMENT_HANDLING", () => Kr(null));
    if (it = Kr(null), Hi(P, "tagNameCheck") && rt(P.tagNameCheck) && (it.tagNameCheck = P.tagNameCheck), Hi(P, "attributeNameCheck") && rt(P.attributeNameCheck) && (it.attributeNameCheck = P.attributeNameCheck), Hi(P, "allowCustomizedBuiltInElements") && typeof P.allowCustomizedBuiltInElements == "boolean" && (it.allowCustomizedBuiltInElements = P.allowCustomizedBuiltInElements), si(it), St && (It = !1), yn && (Gt = !0), zn && (Me = xt({}, F1), Re = Kr(null), zn.html === !0 && (xt(Me, J1), xt(Re, W1)), zn.svg === !0 && (xt(Me, Zm), xt(Re, Pm), xt(Re, vf)), zn.svgFilters === !0 && (xt(Me, Qm), xt(Re, Pm), xt(Re, vf)), zn.mathMl === !0 && (xt(Me, Km), xt(Re, eb), xt(Re, vf))), Et.tagCheck = null, Et.attributeCheck = null, Hi(z, "ADD_TAGS") && (typeof z.ADD_TAGS == "function" ? Et.tagCheck = z.ADD_TAGS : lo(z.ADD_TAGS) && (Me === Ge && (Me = Ji(Me)), xt(Me, z.ADD_TAGS, Ot))), Hi(z, "ADD_ATTR") && (typeof z.ADD_ATTR == "function" ? Et.attributeCheck = z.ADD_ATTR : lo(z.ADD_ATTR) && (Re === _t && (Re = Ji(Re)), xt(Re, z.ADD_ATTR, Ot))), Hi(z, "ADD_FORBID_CONTENTS") && lo(z.ADD_FORBID_CONTENTS) && (Fe === qa && (Fe = Ji(Fe)), xt(Fe, z.ADD_FORBID_CONTENTS, Ot)), vn && (Me["#text"] = !0), Bt && xt(Me, [
      "html",
      "head",
      "body"
    ]), Me.table && (xt(Me, ["tbody"]), delete At.tbody), z.TRUSTED_TYPES_POLICY) {
      if (typeof z.TRUSTED_TYPES_POLICY.createHTML != "function") throw zl('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');
      if (typeof z.TRUSTED_TYPES_POLICY.createScriptURL != "function") throw zl('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');
      const be = ee;
      ee = z.TRUSTED_TYPES_POLICY;
      try {
        me = B("");
      } catch (ye) {
        throw ee = be, ye;
      }
    } else z.TRUSTED_TYPES_POLICY === null ? (ee = void 0, me = "") : (ee === void 0 && (ee = J()), ee && typeof me == "string" && (me = B("")));
    Zn && Zn(z), gi = z;
  }, ht = xt({}, [
    ...Zm,
    ...Qm,
    ...y4
  ]), kn = xt({}, [...Km, ...v4]), ea = function(z, P, be) {
    return P.namespaceURI === rn ? z === "svg" : P.namespaceURI === Mt ? z === "svg" && (be === "annotation-xml" || Kn[be]) : !!ht[z];
  }, oi = function(z, P, be) {
    return P.namespaceURI === rn ? z === "math" : P.namespaceURI === ri ? z === "math" && tn[be] : !!kn[z];
  }, qt = function(z, P, be) {
    return P.namespaceURI === ri && !tn[be] || P.namespaceURI === Mt && !Kn[be] ? !1 : !kn[z] && (dl[z] || !ht[z]);
  }, bn = function(z) {
    const P = de(z), be = Is(H(z)), ye = C(z);
    let He, qe;
    return ye && k(ye) === Cn.element ? (He = { namespaceURI: de(ye) }, qe = Is(H(ye))) : (He = { namespaceURI: oe }, qe = "template"), Ye[P] ? P === ri ? ea(be, He, qe) : P === Mt ? oi(be, He, qe) : P === rn ? qt(be, He, qe) : !!(Ln === "application/xhtml+xml" && Ye[P]) : !1;
  }, Pe = function(z) {
    dc(a.removed, { element: z });
    try {
      C(z).removeChild(z);
    } catch {
      if (w(z), !C(z)) throw zl("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
    }
  }, ga = function(z, P, be) {
    try {
      E(z, P);
    } catch {
      try {
        z.removeAttribute(be);
      } catch {
      }
    }
  }, zt = function(z) {
    ia(z);
    const P = _(z);
    P && Ml(o4(P), (ye) => {
      try {
        w(ye);
      } catch {
      }
    });
    const be = k(z) === Cn.element ? M(z) : null;
    if (be) for (let ye = be.length - 1; ye >= 0; --ye) {
      const He = be[ye], qe = He && He.name;
      typeof qe == "string" && ga(z, He, qe);
    }
  }, ta = function(z, P, be) {
    if (!be) try {
      be = P.getAttributeNode(z);
    } catch {
      be = null;
    }
    dc(a.removed, {
      attribute: be || null,
      from: P
    });
    try {
      be ? E(P, be) : P.removeAttribute(z);
    } catch {
      try {
        P.removeAttribute(z);
      } catch {
      }
    }
    if (z === "is")
      if (Gt || yn) try {
        Pe(P);
      } catch {
      }
      else try {
        P.setAttribute(z, "");
      } catch {
      }
  }, na = function(z) {
    const P = M(z);
    if (P)
      for (let be = P.length - 1; be >= 0; --be) {
        const ye = P[be], He = ye && ye.name;
        typeof He != "string" || Re[Ot(He)] || ga(z, ye, He);
      }
  }, Bi = function(z, P) {
    let be = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1;
    const ye = [z];
    for (; ye.length > 0; ) {
      const He = ye.pop();
      if (P(He) === !1) continue;
      if (be && k(He) === Cn.element) {
        const Ze = D(He);
        Ke(Ze) && ye.push(Ze);
      }
      const qe = _(He);
      if (qe) for (let Ze = qe.length - 1; Ze >= 0; --Ze) ye.push(qe[Ze]);
    }
  }, ia = function(z) {
    Bi(z, (P) => {
      k(P) === Cn.element && na(P);
    });
  }, aa = function(z) {
    const P = [];
    return Bi(z, (be) => {
      P.push(be);
    }, !0), P;
  }, _i = function(z, P) {
    const be = Im();
    Ml(aa(z), (ye) => {
      k(ye) === Cn.element && Xm(be, ye);
    }), Ml(P, (ye) => {
      k(ye) === Cn.element && !hc(be, ye) && na(ye);
    });
  }, Ei = function(z, P) {
    let be = !1;
    return Ml(a.removed, (ye) => {
      ye.element && (be = be || ye.element === z, ia(ye.element));
    }), _i(z, P), be;
  }, $i = 8, jn = function(z, P) {
    const be = Lt;
    let ye = null;
    const He = () => (ye || (ye = Im(), Ml(P, (qe) => {
      Xm(ye, qe);
    })), ye);
    for (let qe = 0; ; qe++) {
      const Ze = aa(z), vt = [z];
      let fi = !1;
      if (Ml(Ze, (mn) => {
        k(mn) === Cn.documentFragment ? dc(vt, mn) : !fi && !hc(be, mn) && (fi = hc(He(), mn));
      }), !fi) return;
      if (qe >= $i) throw zl("the tree kept changing during in-place sanitization; refusing to return it");
      Ml(vt, (mn, Kt) => {
        yt(mn, Kt > 0, z, He());
      });
    }
  }, yt = function(z, P, be, ye) {
    const He = Ni(z);
    let qe;
    for (; qe = He.nextNode(); )
      !hc(ye, qe) || hc(Lt, qe) || (P && Un(pe.uponSanitizeShadowNode, qe, null), xa(qe, be), Rn(qe, be), Ke(qe.content) && Jn(qe.content));
  }, ci = function(z) {
    Lt && Xm(Lt, z);
  }, la = function(z, P) {
    return ft ? z === "patchsrc" ? !0 : z === "for" && P !== "label" && P !== "output" : !1;
  }, Ia = function(z) {
    ft && Bi(z, (P) => {
      const be = k(P);
      if (be === Cn.processingInstruction || be === Cn.comment && li(nb, P.data)) {
        try {
          w(P);
        } catch {
        }
        return !1;
      }
      if (be === Cn.element) {
        const ye = P, He = Ot(H(P));
        try {
          ye.hasAttribute && ye.hasAttribute("patchsrc") && ye.removeAttribute("patchsrc"), ye.hasAttribute && ye.hasAttribute("for") && la("for", He) && ye.removeAttribute("for");
        } catch {
        }
      }
      return !0;
    });
  }, ui = function(z) {
    let P = null, be = null;
    if (fn) z = "<remove></remove>" + z;
    else {
      const qe = Z1(z, /^[\r\n\t ]+/);
      be = qe && qe[0];
    }
    Ln === "application/xhtml+xml" && oe === rn && (z = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' + z + "</body></html>");
    const ye = ee ? B(z) : z;
    if (oe === rn) try {
      P = new y().parseFromString(ye, Ln);
    } catch {
    }
    if (!P || !P.documentElement) {
      P = ae.createDocument(oe, "template", null);
      try {
        P.documentElement.innerHTML = ke ? me : ye;
      } catch {
      }
    }
    const He = P.body || P.documentElement;
    return z && be && He.insertBefore(s.createTextNode(be), He.childNodes[0] || null), oe === rn ? L.call(P, Bt ? "html" : "body")[0] : Bt ? P.documentElement : He;
  }, Ni = function(z) {
    const P = V ? V(z) : z.ownerDocument;
    return he.call(P || z, z, v.SHOW_ELEMENT | v.SHOW_COMMENT | v.SHOW_TEXT | v.SHOW_PROCESSING_INSTRUCTION | v.SHOW_CDATA_SECTION, null);
  }, Xa = function(z) {
    return z = mc(z, Se, " "), z = mc(z, le, " "), z = mc(z, Te, " "), z;
  }, ya = function(z) {
    var P;
    Ol(z);
    const be = (P = z.querySelectorAll) === null || P === void 0 ? void 0 : P.call(z, "template");
    be && Ml(be, (ye) => {
      Ke(ye.content) && ya(ye.content);
    });
  }, Ol = function(z) {
    z.normalize();
    const P = V ? V(z) : z.ownerDocument, be = he.call(P || z, z, v.SHOW_TEXT | v.SHOW_COMMENT | v.SHOW_CDATA_SECTION | v.SHOW_PROCESSING_INSTRUCTION, null);
    let ye = be.nextNode();
    for (; ye; )
      ye.data = Xa(ye.data), ye = be.nextNode();
  }, Dl = function(z) {
    const P = Q ? Q(z) : null;
    return typeof P != "string" || Ot(P) !== "form" ? !1 : typeof z.nodeName != "string" || typeof z.textContent != "string" || typeof z.removeChild != "function" || z.attributes !== M(z) || typeof z.removeAttribute != "function" || typeof z.removeAttributeNode != "function" || typeof z.getAttributeNode != "function" || typeof z.setAttribute != "function" || typeof z.namespaceURI != "string" || typeof z.insertBefore != "function" || typeof z.hasChildNodes != "function" || z.nodeType !== R(z) || z.childNodes !== _(z);
  }, Ke = function(z) {
    if (!R || typeof z != "object" || z === null) return !1;
    try {
      return R(z) === Cn.documentFragment;
    } catch {
      return !1;
    }
  }, va = function(z) {
    if (!R || typeof z != "object" || z === null) return !1;
    try {
      return typeof R(z) == "number";
    } catch {
      return !1;
    }
  };
  function Un(xe, z, P) {
    xe.length !== 0 && Ml(xe, (be) => {
      be.call(a, z, P, gi);
    });
  }
  const hl = function(z, P) {
    return !!(ft && z.hasChildNodes() && !va(z.firstElementChild) && li(Jm, z.textContent) && li(Jm, z.innerHTML) || ft && M4[P] && k(z) === Cn.element && de(z) === rn && (va(z.firstElementChild) || typeof z.textContent == "string" && li(Jm, z.textContent)) || z.nodeType === Cn.processingInstruction || ft && z.nodeType === Cn.comment && li(nb, z.data));
  }, Pn = function(z, P) {
    if (z instanceof RegExp) return li(z, P);
    if (z instanceof Function) {
      for (var be = arguments.length, ye = new Array(be > 2 ? be - 2 : 0), He = 2; He < be; He++) ye[He - 2] = arguments[He];
      return !!z(P, ...ye);
    }
    return !1;
  }, on = function(z, P, be) {
    if (!At[P] && Bn(P) && Pn(it.tagNameCheck, P)) return !1;
    if (vn && !Fe[P] && !Fe[Is(P)]) {
      const ye = C(z), He = _(z);
      if (He && ye) {
        const qe = He.length;
        for (let Ze = qe - 1; Ze >= 0; --Ze) {
          const vt = z === be ? S(He[Ze], !0) : He[Ze];
          ye.insertBefore(vt, N(z));
        }
      }
    }
    return Pe(z), !0;
  }, vs = function(z, P, be, ye) {
    return z.length === 0 ? P : P === be || P === ye ? Ji(P) : P;
  }, sa = function(z, P) {
    return z === P || C(z) !== null ? !1 : (dn && ia(z), !0);
  }, xa = function(z, P) {
    if (ci(z), Un(pe.beforeSanitizeElements, z, null), sa(z, P)) return !0;
    if (Dl(z))
      return Pe(z), !0;
    const be = Ot(H(z));
    if (Me = vs(pe.uponSanitizeElement, Me, Ge, $t), Un(pe.uponSanitizeElement, z, {
      tagName: be,
      allowedTags: Me
    }), sa(z, P)) return !0;
    if (hl(z, be))
      return Pe(z), !0;
    if (At[be] || !(Et.tagCheck instanceof Function && Et.tagCheck(be)) && !Me[be]) {
      const ye = on(z, be, P);
      return ye === !1 && (Un(pe.afterSanitizeElements, z, null), sa(z, P)) ? !0 : ye;
    }
    if (k(z) === Cn.element && !bn(z) || (be === "noscript" || be === "noembed" || be === "noframes") && li(A4, z.innerHTML))
      return Pe(z), !0;
    if (St && z.nodeType === Cn.text) {
      const ye = Xa(z.textContent);
      z.textContent !== ye && (dc(a.removed, { element: z.cloneNode() }), z.textContent = ye);
    }
    return Un(pe.afterSanitizeElements, z, null), sa(z, P);
  }, xs = function(z, P, be) {
    if (Mn[P] || la(P, z) || Li && (P === "id" || P === "name") && (be in s || be in Ya)) return !1;
    const ye = Re[P] || Et.attributeCheck instanceof Function && Et.attributeCheck(P, z);
    return It && li(Ce, P) || sn && li(we, P) ? !0 : ye ? en[P] || li($e, mc(be, ze, "")) || (P === "src" || P === "xlink:href" || P === "href") && z !== "script" && Q1(be, "data:") === 0 && xn[z] || bt && !li(Ne, mc(be, ze, "")) ? !0 : !be : Bn(z) && Pn(it.tagNameCheck, z) && Pn(it.attributeNameCheck, P, z) || P === "is" && it.allowCustomizedBuiltInElements && Pn(it.tagNameCheck, be);
  }, rr = xt({}, [
    "annotation-xml",
    "color-profile",
    "font-face",
    "font-face-format",
    "font-face-name",
    "font-face-src",
    "font-face-uri",
    "missing-glyph"
  ]), Bn = function(z) {
    return !rr[Is(z)] && li(Ve, z);
  }, qi = function(z, P, be, ye) {
    if (ee && typeof g == "object" && typeof g.getAttributeType == "function" && !be) switch (g.getAttributeType(z, P)) {
      case "TrustedHTML":
        return B(ye);
      case "TrustedScriptURL":
        return X(ye);
    }
    return ye;
  }, ba = function(z, P, be, ye) {
    try {
      return be ? z.setAttributeNS(be, P, ye) : z.setAttribute(P, ye), Dl(z) ? (Pe(z), !1) : !0;
    } catch {
      return ta(P, z), !1;
    }
  }, Sa = function(z, P) {
    return ft && li(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, P) ? !0 : Is(z) === "attributename" && Z1(P, "href") !== null;
  }, Rn = function(z, P) {
    if (Un(pe.beforeSanitizeAttributes, z, null), sa(z, P)) return;
    const be = z.attributes;
    if (!be || Dl(z)) return;
    Re = vs(pe.uponSanitizeAttribute, Re, _t, Qn);
    const ye = {
      attrName: "",
      attrValue: "",
      keepAttr: !0,
      allowedAttributes: Re,
      forceKeepAttr: void 0
    };
    let He = be.length;
    const qe = Ot(z.nodeName);
    for (; He--; ) {
      const Ze = be[He], vt = Ze.name, fi = Ze.namespaceURI, mn = Ze.value, Kt = Ot(vt), yi = mn;
      let Sn = vt === "value" ? yi : u4(yi), Hl = !1;
      if (ye.attrName = Kt, ye.attrValue = Sn, ye.keepAttr = !0, ye.forceKeepAttr = void 0, Un(pe.uponSanitizeAttribute, z, ye), Sn = ye.attrValue, Zt && (Kt === "id" || Kt === "name") && Q1(Sn, Tt) !== 0 && (ta(vt, z, Ze), Sn = Tt + Sn, Hl = !0), Sa(vt, Sn)) {
        ta(vt, z, Ze);
        continue;
      }
      if (!ye.forceKeepAttr) {
        if (!ye.keepAttr) {
          ta(vt, z, Ze);
          continue;
        }
        if (!Nt && li(ib, Sn)) {
          ta(vt, z, Ze);
          continue;
        }
        if (St && (Sn = Xa(Sn)), !xs(qe, Kt, Sn)) {
          ta(vt, z, Ze);
          continue;
        }
        Sn = qi(qe, Kt, fi, Sn), Sn !== yi && ba(z, vt, fi, Sn) && Hl && G1(a.removed);
      }
    }
    Un(pe.afterSanitizeAttributes, z, null), sa(z, P);
  }, Jn = function(z) {
    let P = null;
    const be = Ni(z);
    for (Un(pe.beforeSanitizeShadowDOM, z, null); P = be.nextNode(); )
      if (Un(pe.uponSanitizeShadowNode, P, null), xa(P, z), Rn(P, z), Ke(P.content) && Jn(P.content), k(P) === Cn.element) {
        const ye = D(P);
        Ke(ye) && (Ti(ye), Jn(ye));
      }
    St && Ol(z), Un(pe.afterSanitizeShadowDOM, z, null);
  }, Ti = function(z) {
    const P = [{
      node: z,
      shadow: null
    }];
    for (; P.length > 0; ) {
      const be = P.pop();
      if (be.shadow) {
        Jn(be.shadow);
        continue;
      }
      const ye = be.node, He = k(ye) === Cn.element, qe = _(ye);
      if (qe) for (let Ze = qe.length - 1; Ze >= 0; --Ze) P.push({
        node: qe[Ze],
        shadow: null
      });
      if (He) {
        const Ze = Q ? Q(ye) : null;
        if (typeof Ze == "string" && Ot(Ze) === "template") {
          const vt = ye.content;
          Ke(vt) && P.push({
            node: vt,
            shadow: null
          });
        }
      }
      if (He) {
        const Ze = D(ye);
        Ke(Ze) && P.push({
          node: null,
          shadow: Ze
        }, {
          node: Ze,
          shadow: null
        });
      }
    }
  };
  return a.sanitize = function(xe) {
    let z = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}, P = null, be = null, ye = null, He = null;
    if (ke = !xe, ke && (xe = "<!-->"), typeof xe != "string" && !va(xe) && (xe = m4(xe), typeof xe != "string"))
      throw zl("dirty is not a string, aborting");
    if (!a.isSupported) return xe;
    gn ? (Me = $t, Re = Qn) : Ui(z), (pe.uponSanitizeElement.length > 0 || pe.uponSanitizeAttribute.length > 0) && (Me = Ji(Me)), pe.uponSanitizeAttribute.length > 0 && (Re = Ji(Re)), a.removed = [];
    const qe = dn && typeof xe != "string" && va(xe);
    let Ze = [];
    const vt = Lt;
    if (qe) {
      Ia(xe);
      const Kt = H(xe);
      if (typeof Kt == "string") {
        const yi = Ot(Kt);
        if (!Me[yi] || At[yi])
          throw zt(xe), zl("root node is forbidden and cannot be sanitized in-place");
      }
      if (Dl(xe))
        throw zt(xe), zl("root node is clobbered and cannot be sanitized in-place");
      Ze = aa(xe), Lt = Im();
    } else if (va(xe))
      P = ui("<!---->"), be = P.ownerDocument.importNode(xe, !0), be.nodeType === Cn.element && be.nodeName === "BODY" || be.nodeName === "HTML" ? P = be : P.appendChild(be), Ti(P);
    else {
      if (!Gt && !St && !Bt && xe.indexOf("<") === -1) return ee && Wt ? B(xe) : xe;
      if (P = ui(xe), !P) return Gt ? null : Wt ? me : "";
    }
    P && fn && Pe(P.firstChild);
    const fi = qe ? xe : P;
    try {
      qe && Ti(xe);
      const Kt = Ni(fi);
      for (; ye = Kt.nextNode(); )
        xa(ye, fi), Rn(ye, fi), Ke(ye.content) && Jn(ye.content);
      qe && jn(xe, Ze);
    } catch (Kt) {
      throw qe && (zt(xe), Ei(xe, Ze)), Kt;
    } finally {
      Lt = vt;
    }
    if (qe) {
      if (Ei(xe, Ze)) throw zl("a node selected for removal could not be safely returned; refusing to sanitize in place");
      return St && ya(xe), xe;
    }
    if (Gt) {
      if (St && ya(P), yn)
        for (He = Ee.call(P.ownerDocument); P.firstChild; ) He.appendChild(P.firstChild);
      else He = P;
      return (Re.shadowroot || Re.shadowrootmode) && (He = ce.call(r, He, !0)), He;
    }
    let mn = Bt ? P.outerHTML : P.innerHTML;
    return Bt && Me["!doctype"] && P.ownerDocument && P.ownerDocument.doctype && P.ownerDocument.doctype.name && li(T4, P.ownerDocument.doctype.name) && (mn = "<!DOCTYPE " + P.ownerDocument.doctype.name + `>
` + mn), St && (mn = Xa(mn)), ee && Wt ? B(mn) : mn;
  }, a.setConfig = function() {
    let xe = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    Ui(xe), gn = !0, $t = Me, Qn = Re;
  }, a.clearConfig = function() {
    gi = null, gn = !1, $t = null, Qn = null, ee = te, me = "";
  }, a.isValidAttribute = function(xe, z, P) {
    gi || Ui({});
    const be = Ot(xe), ye = Ot(z);
    return typeof P == "string" && (Sa(z, P) || !Nt && li(ib, P)) ? !1 : xs(be, ye, P);
  }, a.addHook = function(xe, z) {
    typeof z == "function" && Hi(pe, xe) && dc(pe[xe], z);
  }, a.removeHook = function(xe, z) {
    if (Hi(pe, xe)) {
      if (z !== void 0) {
        const P = r4(pe[xe], z);
        return P === -1 ? void 0 : c4(pe[xe], P, 1)[0];
      }
      return G1(pe[xe]);
    }
  }, a.removeHooks = function(xe) {
    Hi(pe, xe) && (pe[xe] = []);
  }, a.removeAllHooks = function() {
    pe = ab();
  }, a;
}
var j4 = Rw();
function Cp({ models: n, value: a, onChange: s, disabled: r }) {
  const [o, f] = A.useState(!1), h = A.useRef(null), m = A.useRef(null), v = A.useId(), y = Object.keys(n), g = r || !y.length, p = (S = !1) => {
    f(!1), S && m.current?.focus();
  };
  return A.useEffect(() => {
    g && f(!1);
  }, [g]), A.useEffect(() => {
    if (!o) return;
    h.current?.querySelectorAll('[role="option"]')?.[Math.max(0, y.indexOf(a))]?.focus();
    const w = (E) => {
      h.current?.contains(E.target) || f(!1);
    };
    return document.addEventListener("pointerdown", w), () => document.removeEventListener("pointerdown", w);
  }, [o]), /* @__PURE__ */ d.jsxs("div", { ref: h, className: "fm-chat-model", onBlur: (S) => {
    S.currentTarget.contains(S.relatedTarget) || f(!1);
  }, children: [
    /* @__PURE__ */ d.jsxs("button", { ref: m, type: "button", className: "fm-chat-model-trigger", "aria-label": "对话模型：" + (n[a]?.label || "无模型"), "aria-haspopup": "listbox", "aria-expanded": o, "aria-controls": o ? v : void 0, disabled: g, onClick: () => f(!o), onKeyDown: (S) => {
      ["ArrowDown", "ArrowUp"].includes(S.key) && (S.preventDefault(), f(!0));
    }, children: [
      /* @__PURE__ */ d.jsx(bE, { size: 15 }),
      /* @__PURE__ */ d.jsx("span", { children: n[a]?.label || "无模型" }),
      /* @__PURE__ */ d.jsx(hs, { size: 14 })
    ] }),
    o && /* @__PURE__ */ d.jsx("div", { id: v, className: "fm-chat-model-menu", role: "listbox", "aria-label": "对话模型", onKeyDown: (S) => {
      if (S.key === "Escape") {
        S.preventDefault(), S.stopPropagation(), p(!0);
        return;
      }
      const w = Array.from(S.currentTarget.querySelectorAll('[role="option"]')), E = w.indexOf(document.activeElement), N = S.key === "ArrowDown" ? (E + 1) % w.length : S.key === "ArrowUp" ? (E - 1 + w.length) % w.length : S.key === "Home" ? 0 : S.key === "End" ? w.length - 1 : -1;
      N >= 0 && (S.preventDefault(), w[N]?.focus());
    }, children: y.map((S) => /* @__PURE__ */ d.jsxs("button", { type: "button", role: "option", "aria-selected": S === a, tabIndex: S === a ? 0 : -1, onClick: () => {
      s(S), p(!0);
    }, children: [
      /* @__PURE__ */ d.jsx("span", { children: n[S].label }),
      S === a && /* @__PURE__ */ d.jsx(pi, { size: 17 })
    ] }, S)) })
  ] });
}
function R4({ items: n, selected: a, onChoose: s, onRename: r, onDelete: o, onRefresh: f }) {
  const [h, m] = A.useState(null), [v, y] = A.useState(null), [g, p] = A.useState(""), [S, w] = A.useState(""), E = A.useRef(null), N = A.useRef(null), _ = A.useRef(null), C = A.useRef(null), D = n.find((H) => H.id === h?.id), M = (H = !1) => {
    m(null), H && C.current?.focus();
  }, R = (H, q, de, ee) => {
    g || v || (C.current = ee, w(""), m({ id: H.id, x: q, y: de }));
  }, Q = (H) => E.current?.querySelector(`[data-conversation="${CSS.escape(H)}"] .fm-chat-conversation-open`)?.focus();
  A.useLayoutEffect(() => {
    if (!h || !N.current) return;
    const H = N.current.getBoundingClientRect();
    N.current.style.left = Math.max(8, Math.min(h.x, window.innerWidth - H.width - 8)) + "px", N.current.style.top = Math.max(8, Math.min(h.y, window.innerHeight - H.height - 8)) + "px", N.current.querySelector("button:not(:disabled)")?.focus();
  }, [h]), A.useEffect(() => {
    if (!h) return;
    const H = (de) => {
      N.current?.contains(de.target) || M();
    }, q = () => M();
    return document.addEventListener("pointerdown", H), window.addEventListener("resize", q), window.addEventListener("scroll", q, !0), () => {
      document.removeEventListener("pointerdown", H), window.removeEventListener("resize", q), window.removeEventListener("scroll", q, !0);
    };
  }, [h]), A.useEffect(() => {
    h && !D && M();
  }, [h, D]), A.useEffect(() => {
    v && (_.current?.focus(), _.current?.select());
  }, [v?.id]);
  const V = async () => {
    const H = n.find((q) => q.id === v?.id);
    if (!(!H || !v?.title.trim() || g)) {
      p(H.id), w("");
      try {
        await r(H, v.title.trim()), y(null), requestAnimationFrame(() => Q(H.id));
      } catch (q) {
        w(q.message), f().catch(() => {
        });
      } finally {
        p("");
      }
    }
  }, k = async (H) => {
    M(), p(H.id), w("");
    try {
      await o(H);
    } catch (q) {
      w(q.message), f().catch(() => {
      });
    } finally {
      p("");
    }
  };
  return /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-history-items", ref: E, children: [
    /* @__PURE__ */ d.jsx("div", { className: "fm-chat-list", children: n.length ? n.map((H) => /* @__PURE__ */ d.jsx("div", { "data-conversation": H.id, className: "fm-chat-conversation-row" + (a === H.id ? " selected" : "") + (h?.id === H.id ? " menu-open" : ""), onContextMenu: (q) => {
      v?.id !== H.id && (q.preventDefault(), R(H, q.clientX, q.clientY, q.currentTarget.querySelector("button")));
    }, children: v?.id === H.id ? /* @__PURE__ */ d.jsxs("form", { className: "fm-chat-row-rename", onSubmit: (q) => {
      q.preventDefault(), V();
    }, onKeyDown: (q) => {
      q.key === "Escape" && (q.preventDefault(), q.stopPropagation(), g || (y(null), w(""), requestAnimationFrame(() => Q(H.id))));
    }, children: [
      /* @__PURE__ */ d.jsx("input", { ref: _, "aria-label": "对话名称", value: v.title, maxLength: 80, disabled: !!g, onChange: (q) => y({ ...v, title: q.target.value }) }),
      /* @__PURE__ */ d.jsx("button", { type: "submit", "aria-label": "保存名称", disabled: !!g || !v.title.trim(), children: /* @__PURE__ */ d.jsx(pi, { size: 15 }) }),
      /* @__PURE__ */ d.jsx("button", { type: "button", "aria-label": "取消改名", disabled: !!g, onClick: () => {
        y(null), w(""), requestAnimationFrame(() => Q(H.id));
      }, children: /* @__PURE__ */ d.jsx(wi, { size: 15 }) })
    ] }) : /* @__PURE__ */ d.jsxs("button", { type: "button", className: "fm-chat-conversation-open", "aria-current": a === H.id ? "page" : void 0, onClick: () => s(H.id), onKeyDown: (q) => {
      if (q.key === "ContextMenu" || q.key === "F10" && q.shiftKey) {
        q.preventDefault();
        const de = q.currentTarget.getBoundingClientRect();
        R(H, de.left + 16, de.bottom + 4, q.currentTarget);
      }
    }, children: [
      /* @__PURE__ */ d.jsx("span", { children: H.title }),
      H.active_turn && /* @__PURE__ */ d.jsx(If, { size: 14, className: "fm-chat-spinner", "aria-label": "正在回复" })
    ] }) }, H.id)) : /* @__PURE__ */ d.jsx("p", { className: "fm-chat-list-empty", children: "暂无对话" }) }),
    S && /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-history-error", role: "alert", children: [
      /* @__PURE__ */ d.jsx("span", { children: S }),
      /* @__PURE__ */ d.jsx("button", { type: "button", "aria-label": "关闭对话操作提示", onClick: () => w(""), children: /* @__PURE__ */ d.jsx(wi, { size: 14 }) })
    ] }),
    h && D && /* @__PURE__ */ d.jsxs("div", { ref: N, role: "menu", "aria-label": "对话操作", className: "fm-chat-context-menu", style: { left: h.x, top: h.y }, onContextMenu: (H) => H.preventDefault(), onBlur: (H) => {
      H.currentTarget.contains(H.relatedTarget) || M();
    }, onKeyDown: (H) => {
      if (H.key === "Escape") {
        H.preventDefault(), H.stopPropagation(), M(!0);
        return;
      }
      if (H.key === "Tab") {
        H.preventDefault(), M(!0);
        return;
      }
      const q = Array.from(H.currentTarget.querySelectorAll("button:not(:disabled)")), de = q.indexOf(document.activeElement), ee = H.key === "ArrowDown" ? (de + 1) % q.length : H.key === "ArrowUp" ? (de - 1 + q.length) % q.length : H.key === "Home" ? 0 : H.key === "End" ? q.length - 1 : -1;
      ee >= 0 && (H.preventDefault(), q[ee]?.focus());
    }, children: [
      /* @__PURE__ */ d.jsxs("button", { type: "button", role: "menuitem", onClick: () => {
        y({ id: D.id, title: D.title }), M();
      }, children: [
        /* @__PURE__ */ d.jsx(Mp, { size: 16 }),
        "重命名"
      ] }),
      D.can_delete && /* @__PURE__ */ d.jsxs("button", { type: "button", role: "menuitem", disabled: !!D.active_turn, title: D.active_turn ? "请等待回复结束后删除" : void 0, onClick: () => {
        k(D);
      }, children: [
        /* @__PURE__ */ d.jsx(Qs, { size: 16 }),
        "删除"
      ] })
    ] })
  ] });
}
class Ow extends Error {
  constructor(a, s) {
    super(s), this.status = a;
  }
  status;
}
async function og(n, a, s, r) {
  const o = await fetch(a, { method: r || (s === void 0 ? "GET" : "POST"), credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Workspace-Id": String(n) }, body: s === void 0 ? void 0 : JSON.stringify(s) }), f = await o.json();
  if (!o.ok) throw new Ow(o.status, typeof f.detail == "string" ? f.detail : "操作未完成，请重试");
  return f;
}
function O4({ text: n }) {
  const a = A.useMemo(() => j4.sanitize(Ht.parse(n, { async: !1, gfm: !0, breaks: !0 }), { ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "hr", "a", "table", "thead", "tbody", "tr", "th", "td"], ALLOWED_ATTR: ["href", "title"], ALLOW_DATA_ATTR: !1, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i }), [n]);
  return /* @__PURE__ */ d.jsx("div", { className: "fm-chat-prose", dangerouslySetInnerHTML: { __html: a }, onClick: (s) => {
    const r = s.target.closest("a");
    r && (s.preventDefault(), /^https?:|^mailto:/i.test(r.href) && window.open(r.href, "_blank", "noopener,noreferrer"));
  } });
}
const lb = () => /* @__PURE__ */ d.jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ d.jsx("path", { fill: "currentColor", d: "M12 1c1.7 7 4 9.3 11 11-7 1.7-9.3 4-11 11C10.3 16 8 13.7 1 12 8 10.3 10.3 8 12 1Z" }) });
function D4(n) {
  const { workspace: a, userId: s, compact: r, inline: o, project: f, node: h } = n, m = `fm-chat-${s}-${a}-${f || "main"}-${h || ""}`, [v, y] = A.useState([]), [g, p] = A.useState(null), [S, w] = A.useState(() => sessionStorage.getItem(m + "-active") || ""), [E, N] = A.useState(null), [_, C] = A.useState("deepseek-flash"), [D, M] = A.useState(() => sessionStorage.getItem(m + "-draft-" + S) || ""), [R, Q] = A.useState(!1), [V, k] = A.useState(""), [H, q] = A.useState(!0), [de, ee] = A.useState(!1), [me, te] = A.useState(null), [O, Y] = A.useState(""), [j, B] = A.useState(""), [X, J] = A.useState(null), [I, ae] = A.useState(!1), [he, Ee] = A.useState(!1), [L, ce] = A.useState(null), [pe, Se] = A.useState([]), [le, Te] = A.useState(""), [Ce, we] = A.useState("新画布"), [Ne, ze] = A.useState(null), [Ve, $e] = A.useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(m + "-writes") || "{}");
    } catch {
      return {};
    }
  }), [Me, Ge] = A.useState(!1), [Re, _t] = A.useState(null), it = A.useRef(null), At = (oe) => $e((ke) => {
    const Ye = oe(ke);
    return sessionStorage.setItem(m + "-writes", JSON.stringify(Ye)), Ye;
  }), Mn = (oe) => At((ke) => {
    const Ye = { ...ke };
    return delete Ye[oe], Ye;
  }), Et = A.useRef(!1), sn = A.useRef(!0), It = A.useRef(null), bt = A.useRef(null), Nt = A.useRef(null), St = A.useRef(!0), ft = A.useRef(!0), Bt = A.useRef(S), gn = A.useRef(null), $t = (oe, ke, Ye) => og(a, oe, ke, Ye), Qn = async () => {
    const oe = await $t("/api/chats" + (f ? "?project=" + encodeURIComponent(f) + "&node=" + encodeURIComponent(h || "") : ""));
    if (ft.current) {
      if (y(oe.conversations), sn.current && r && !Bt.current && oe.conversations.length) {
        const ke = oe.conversations[0].id;
        Bt.current = ke, w(ke), sessionStorage.setItem(m + "-active", ke);
      }
      sn.current = !1;
    }
  }, fn = async () => {
    const oe = await $t("/api/chat/config");
    ft.current && (It.current = oe, N(oe), C((ke) => ke in oe.models ? ke : Object.keys(oe.models)[0] || ""));
  }, Gt = (oe) => {
    ft.current && (oe.conversation.id === Bt.current && p(oe), y((ke) => [oe.conversation, ...ke.filter((Ye) => Ye.id !== oe.conversation.id)].sort((Ye, K) => K.updated - Ye.updated)));
  }, yn = (oe) => {
    M(sessionStorage.getItem(m + "-draft-" + oe) || "");
    const ke = v.find((Ye) => Ye.id === oe);
    ke && E?.models[ke.model] && C(ke.model), Bt.current = oe, w(oe), p(null), k(""), te(null), ee(!1), gn.current = null, q(!!oe), St.current = !0, Ee(!1), sessionStorage.setItem(m + "-active", oe);
  };
  A.useEffect(() => {
    ft.current = !0, Promise.all([fn(), Qn()]).catch((ke) => k(ke.message)).finally(() => q(!1));
    const oe = setInterval(() => {
      fn().catch(() => {
      }), Qn().catch(() => {
      });
    }, 1e4);
    return () => {
      ft.current = !1, clearInterval(oe);
    };
  }, [a, f, h]), A.useEffect(() => {
    Nt.current && !o && (Nt.current.style.height = "0px", Nt.current.style.height = Math.min(Nt.current.scrollHeight, 180) + "px");
  }, [D, S, o]), A.useEffect(() => {
    if (!S) return;
    let oe = !1;
    const ke = "/api/chats/" + S;
    $t(ke).then((K) => {
      oe || (Gt(K), C((at) => K.conversation.model in (It.current?.models || {}) ? K.conversation.model : at), q(!1));
    }).catch((K) => {
      oe || (k(K.message), q(!1), K.status === 404 && yn(""));
    });
    const Ye = new EventSource(ke + "/events?workspace=" + a);
    return Ye.onmessage = (K) => {
      if (oe) return;
      ae(!1);
      const at = JSON.parse(K.data);
      Gt(at), q(!1);
    }, Ye.onerror = () => {
      oe || ae(!0);
    }, Ye.addEventListener("unavailable", () => {
      Ye.close(), oe || (k("这段对话已删除或你已无权访问"), p(null), q(!1));
    }), () => {
      oe = !0, Ye.close();
    };
  }, [S, a]), A.useEffect(() => {
    St.current && bt.current ? (bt.current.scrollTop = bt.current.scrollHeight, Ee(!1)) : g?.conversation.active_turn && Ee(!0);
  }, [g?.messages]), A.useEffect(() => {
    if (!O) return;
    const oe = setTimeout(() => Y(""), 4e3);
    return () => clearTimeout(oe);
  }, [O]), A.useEffect(() => {
    if (!g || !n.onApply || it.current !== null) return;
    const oe = g.messages.find((K) => K.role === "assistant" && K.state !== "running" && Ve[K.id]?.cid === g.conversation.id);
    if (!oe) return;
    if (oe.state !== "complete") {
      Mn(oe.id);
      return;
    }
    const ke = g.messages.find((K) => K.id === oe.reply_to);
    let Ye = {};
    try {
      Ye = JSON.parse(ke?.context || "{}");
    } catch {
    }
    if (!Ye.writeback || Ye.project !== f || Ye.node !== h || typeof Ye.text != "string") {
      Mn(oe.id);
      return;
    }
    it.current = oe.id, Ge(!0), n.onApply(g.conversation.id, oe, "replace", { automatic: !0, expectedText: Ye.text, uid: Ve[oe.id].uid }).then(() => {
      ft.current && (_t(oe.id), Y("已更新节点文字，可撤销"));
    }).catch((K) => {
      ft.current && k(K.message);
    }).finally(() => {
      Mn(oe.id), it.current = null, ft.current && Ge(!1);
    });
  }, [g, Ve, f, h]);
  const Wt = !!g?.conversation.active_turn, Li = R || Wt || Me || Object.keys(Ve).length > 0, Zt = A.useRef(n.onActivityChange);
  Zt.current = n.onActivityChange, A.useEffect(() => {
    Zt.current?.(Li);
  }, [Li]);
  const Tt = E?.pricing.items.find((oe) => oe.key === _ + "|reply")?.amount, vn = !!_ && Tt != null && !!E && E.credits.available >= Tt && !R && !Me && !Wt && !H && (!S || !!g), dn = async (oe) => {
    k(""), Q(!0);
    try {
      await oe();
    } catch (ke) {
      k(ke.message);
    } finally {
      ft.current && Q(!1);
    }
  }, Lt = async (oe) => dn(async () => {
    if (!_ || !oe && !D.trim()) return;
    let ke = g;
    const Ye = n.getContext ? await n.getContext() : void 0;
    ke || (ke = await $t("/api/chats", { model: _, context: Ye }), Bt.current = ke.conversation.id, w(ke.conversation.id), sessionStorage.setItem(m + "-active", ke.conversation.id), p(ke));
    const K = JSON.stringify([ke.conversation.id, _, D, oe]);
    gn.current?.signature !== K && (gn.current = { signature: K, uid: crypto.randomUUID() });
    try {
      const at = await $t("/api/chats/" + ke.conversation.id + "/messages", { uid: gn.current.uid, model: _, text: oe ? "" : D, expected_revision: ke.conversation.revision, price_revision: E.pricing.revision, retry: oe || null, context: Ye });
      if (Ye?.writeback && n.onApply) {
        const Qt = [...at.messages].reverse().find((tn) => tn.role === "assistant");
        Qt && At((tn) => ({ ...tn, [Qt.id]: { cid: at.conversation.id, uid: tn[Qt.id]?.uid || crypto.randomUUID() } }));
      }
      Gt(at);
      const Kn = ke.conversation.id;
      M((Qt) => Qt === D ? (sessionStorage.removeItem(m + "-draft-"), sessionStorage.removeItem(m + "-draft-" + Kn), "") : (sessionStorage.setItem(m + "-draft-" + Kn, Qt), Qt)), gn.current = null, St.current = !0, await fn();
    } catch (at) {
      throw at instanceof Ow && at.status === 409 && (Gt(await $t("/api/chats/" + ke.conversation.id)), await fn()), at;
    }
  }), zn = () => dn(async () => {
    Gt(await $t("/api/chats/" + S + "/stop", {})), await fn();
  }), Fe = async (oe) => {
    await $t("/api/chats/" + oe.id, void 0, "DELETE"), Et.current = oe.id === Bt.current, B(oe.id), y((ke) => ke.filter((Ye) => Ye.id !== oe.id)), Et.current && yn(""), ee(!1);
  }, qa = () => dn(async () => {
    g && await Fe(g.conversation);
  }), xn = () => dn(async () => {
    const oe = await $t("/api/chats/" + j + "/restore", {});
    Et.current && !Bt.current ? (yn(j), p(oe)) : Gt(oe), B(""), await Qn();
  }), dt = async (oe) => {
    try {
      await navigator.clipboard.writeText(oe.content), J(oe.id), setTimeout(() => J(null), 2e3);
    } catch {
      k("复制失败，请选择文字手动复制");
    }
  }, en = (oe, ke) => dn(async () => {
    if (n.onApply) {
      const Ye = g?.messages.find((at) => at.id === oe.reply_to);
      let K = {};
      try {
        K = JSON.parse(Ye?.context || "{}");
      } catch {
      }
      await n.onApply(S, oe, ke, { expectedText: K.text }), Y(ke === "new" ? "已新建文本节点" : "已替换节点文字");
    } else {
      ce(oe), Te("");
      const Ye = await $t("/api/canvases");
      Se(Ye.projects);
    }
  }), hn = () => dn(async () => {
    if (!L) return;
    const oe = le ? await $t("/api/canvases/" + le) : await $t("/api/canvases", { title: Ce.trim() || "新画布" }), ke = await $t("/api/chats/" + S + "/apply", { uid: crypto.randomUUID(), message: L.id, project: oe.id, expected_revision: oe.revision, mode: "new" });
    ze({ id: ke.id, message: L.id }), ce(null), Y("已放入画布");
  }), Mt = g?.messages.at(-1), ri = Mt && ["failed", "stopped", "interrupted"].includes(Mt.state) ? Mt.error || (Mt.state === "stopped" ? "已停止，积分已退回" : "生成中断，积分已退回") : "";
  if (o) return /* @__PURE__ */ d.jsx("div", { className: "fm-chat fm-chat-node", children: /* @__PURE__ */ d.jsxs("form", { className: "fm-text-form", onSubmit: (oe) => {
    oe.preventDefault(), vn && Lt();
  }, children: [
    /* @__PURE__ */ d.jsx("div", { className: "fm-text-presets", children: [["补充镜头", "保留原意，补充画面主体、动作、镜头运动和环境细节，只输出可直接使用的镜头提示词。"], ["改写图生视频", "基于当前文字改写为图生视频提示词，重点描述动作、镜头和画面变化，不虚构参考图片中未提供的事实。只输出提示词。"]].map(([oe, ke]) => /* @__PURE__ */ d.jsx("button", { type: "button", disabled: R || Wt, onClick: () => {
      M(ke), Nt.current?.focus();
    }, children: oe }, oe)) }),
    /* @__PURE__ */ d.jsx("textarea", { ref: Nt, className: "composer-prompt", "aria-label": "文本生成要求", placeholder: _ ? "描述你想生成的文字，或说明修改要求" : "暂无可用模型", value: D, maxLength: 12e3, rows: 3, onChange: (oe) => {
      M(oe.target.value), sessionStorage.setItem(m + "-draft-" + S, oe.target.value);
    }, onKeyDown: (oe) => {
      oe.key === "Enter" && !oe.shiftKey && !oe.nativeEvent.isComposing && (oe.preventDefault(), vn && D.trim() && Lt());
    } }),
    (V || ri) && /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-error", role: "alert", children: [
      /* @__PURE__ */ d.jsx("span", { children: V || ri }),
      V && /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "关闭错误提示", onClick: () => k(""), children: /* @__PURE__ */ d.jsx(wi, { size: 14 }) })
    ] }),
    I && /* @__PURE__ */ d.jsx("p", { className: "fm-text-state", role: "status", children: "正在重新连接" }),
    /* @__PURE__ */ d.jsxs("div", { className: "composer-bottom fm-text-bottom", children: [
      /* @__PURE__ */ d.jsx(Cp, { models: E?.models || {}, value: _, disabled: R || Me || Wt, onChange: C }),
      /* @__PURE__ */ d.jsx("span", { className: "fm-chat-cost", title: Tt != null ? `每次生成 ${Tt} 积分，可用 ${E?.credits.available}` : "该模型尚未定价", "aria-label": Tt != null ? `${Tt} 积分` : void 0, children: _ ? Tt == null ? "未定价" : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
        /* @__PURE__ */ d.jsx(lb, {}),
        Tt
      ] }) : null }),
      (Wt || Me) && /* @__PURE__ */ d.jsx("span", { className: "fm-text-state", role: "status", children: Me ? "正在写入" : "生成中" }),
      Wt ? /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-send", "aria-label": "停止生成", onClick: () => {
        zn();
      }, disabled: R, children: /* @__PURE__ */ d.jsx(ip, { size: 15, fill: "currentColor" }) }) : /* @__PURE__ */ d.jsx("button", { type: "submit", className: "fm-chat-send", "aria-label": "生成文本", disabled: !vn || !D.trim(), children: /* @__PURE__ */ d.jsx(_c, { size: 21 }) })
    ] }),
    _ && Tt != null && E && E.credits.available < Tt && !Wt && /* @__PURE__ */ d.jsx("p", { className: "fm-chat-balance", children: "当前空间积分不足" })
  ] }) });
  const rn = r ? n.nodeTitle || "AI 写作" : g?.conversation.title || "新对话";
  return /* @__PURE__ */ d.jsxs("div", { onKeyDown: (oe) => {
    oe.key === "Escape" && de && (ee(!1), oe.stopPropagation());
  }, className: "fm-chat " + (r ? "fm-chat-compact " : "") + (de ? "fm-chat-history-open" : ""), children: [
    /* @__PURE__ */ d.jsxs("aside", { className: "fm-chat-history", "aria-label": "对话历史", children: [
      /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-history-top", children: [
        /* @__PURE__ */ d.jsx("h2", { children: "对话" }),
        /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "关闭对话历史", onClick: () => ee(!1), children: /* @__PURE__ */ d.jsx(wi, { size: 18 }) })
      ] }),
      /* @__PURE__ */ d.jsxs("button", { type: "button", className: "fm-chat-new", onClick: () => yn(""), children: [
        /* @__PURE__ */ d.jsx(La, { size: 18 }),
        "新对话"
      ] }),
      /* @__PURE__ */ d.jsx(R4, { items: v, selected: S, onChoose: yn, onRefresh: Qn, onDelete: Fe, onRename: async (oe, ke) => {
        Gt(await $t("/api/chats/" + oe.id, { title: ke, expected_revision: oe.revision }, "PATCH"));
      } })
    ] }),
    /* @__PURE__ */ d.jsxs("section", { className: "fm-chat-main", "aria-label": "AI 对话", inert: de && !!(r || typeof window < "u" && window.innerWidth <= 760), children: [
      /* @__PURE__ */ d.jsxs("header", { className: "fm-chat-header", children: [
        /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon fm-chat-history-toggle", "aria-expanded": de, "aria-label": "对话历史", onClick: () => ee(!de), children: /* @__PURE__ */ d.jsx(aN, { size: 18 }) }),
        me !== null ? /* @__PURE__ */ d.jsxs("form", { className: "fm-chat-rename", onSubmit: (oe) => {
          oe.preventDefault(), dn(async () => {
            Gt(await $t("/api/chats/" + S, { title: me, expected_revision: g.conversation.revision }, "PATCH")), te(null);
          });
        }, children: [
          /* @__PURE__ */ d.jsx("input", { autoFocus: !0, maxLength: 80, "aria-label": "对话名称", value: me, onChange: (oe) => te(oe.target.value) }),
          /* @__PURE__ */ d.jsx("button", { className: "fm-chat-icon", type: "submit", disabled: R || !me.trim(), "aria-label": "保存名称", children: /* @__PURE__ */ d.jsx(pi, { size: 16 }) }),
          /* @__PURE__ */ d.jsx("button", { className: "fm-chat-icon", type: "button", onClick: () => te(null), "aria-label": "取消改名", children: /* @__PURE__ */ d.jsx(wi, { size: 16 }) })
        ] }) : /* @__PURE__ */ d.jsx("h1", { title: rn, children: rn }),
        /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-header-actions", children: [
          S && !r && /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "重命名对话", onClick: () => te(g?.conversation.title || ""), children: /* @__PURE__ */ d.jsx(Mp, { size: 16 }) }),
          S && g?.conversation.can_delete && /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "删除对话", disabled: Wt || R, onClick: () => {
            qa();
          }, children: /* @__PURE__ */ d.jsx(Qs, { size: 16 }) }),
          r && /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "新对话", onClick: () => yn(""), children: /* @__PURE__ */ d.jsx(La, { size: 18 }) }),
          n.onClose && /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "关闭 AI 写作", onClick: n.onClose, children: /* @__PURE__ */ d.jsx(wi, { size: 18 }) })
        ] })
      ] }),
      /* @__PURE__ */ d.jsx("div", { className: "fm-chat-scroll", ref: bt, onScroll: () => {
        const oe = bt.current;
        St.current = oe.scrollHeight - oe.scrollTop - oe.clientHeight < 80, St.current && Ee(!1);
      }, children: /* @__PURE__ */ d.jsx("div", { className: "fm-chat-messages", children: H && !g ? /* @__PURE__ */ d.jsx("p", { className: "fm-chat-empty-note", role: "status", children: "正在载入对话…" }) : g?.messages.length ? g.messages.map((oe, ke) => /* @__PURE__ */ d.jsx("article", { className: "fm-chat-message " + oe.role, children: oe.role === "user" ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
        /* @__PURE__ */ d.jsx("div", { className: "fm-chat-author", children: oe.author_name || "你" }),
        /* @__PURE__ */ d.jsx("div", { className: "fm-chat-bubble", children: oe.content }),
        JSON.parse(oe.context || "{}").node && /* @__PURE__ */ d.jsxs("small", { className: "fm-chat-context-tag", children: [
          /* @__PURE__ */ d.jsx(gb, { size: 13 }),
          "含节点文字"
        ] })
      ] }) : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
        /* @__PURE__ */ d.jsx("div", { className: "fm-chat-author", children: E?.models[oe.model]?.label || { "deepseek-flash": "DeepSeek Flash", "gpt-4.1": "GPT-4.1" }[oe.model] || oe.model }),
        oe.content ? /* @__PURE__ */ d.jsx(O4, { text: oe.content }) : oe.state === "running" ? /* @__PURE__ */ d.jsxs("p", { className: "fm-chat-wait", role: "status", children: [
          /* @__PURE__ */ d.jsx(If, { size: 15, className: "fm-chat-spinner" }),
          "正在回复"
        ] }) : null,
        oe.state !== "running" && oe.state !== "complete" && /* @__PURE__ */ d.jsx("p", { className: "fm-chat-incomplete", children: oe.error || (oe.state === "stopped" ? "已停止，积分已退回" : "回复中断，积分已退回") }),
        /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-message-actions", children: [
          oe.content && /* @__PURE__ */ d.jsx("button", { type: "button", "aria-label": "复制回答", title: "复制回答", onClick: () => {
            dt(oe);
          }, children: X === oe.id ? /* @__PURE__ */ d.jsx(pi, { size: 16 }) : /* @__PURE__ */ d.jsx(Pr, { size: 16 }) }),
          oe.state === "complete" && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
            Re === oe.id && /* @__PURE__ */ d.jsxs("span", { className: "fm-chat-written", children: [
              /* @__PURE__ */ d.jsx(pi, { size: 14 }),
              "已更新文字"
            ] }),
            n.onApply && /* @__PURE__ */ d.jsx("button", { type: "button", disabled: R || Me, onClick: () => {
              en(oe, "replace");
            }, children: "替换文字" }),
            /* @__PURE__ */ d.jsxs("button", { type: "button", disabled: R, onClick: () => {
              en(oe, "new");
            }, children: [
              /* @__PURE__ */ d.jsx(La, { size: 14 }),
              r ? "新建文本节点" : "放入画布"
            ] }),
            Ne?.message === oe.id && /* @__PURE__ */ d.jsxs("a", { href: "/canvas/" + Ne.id + "?workspace=" + a, children: [
              "打开画布",
              /* @__PURE__ */ d.jsx(OE, { size: 13 })
            ] })
          ] }),
          ke === g.messages.length - 1 && ["failed", "stopped", "interrupted"].includes(oe.state) && /* @__PURE__ */ d.jsxs("button", { type: "button", disabled: !vn, onClick: () => {
            Lt(oe.id);
          }, children: [
            /* @__PURE__ */ d.jsx(mN, { size: 14 }),
            "重试"
          ] })
        ] })
      ] }) }, oe.id)) : /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-empty", children: [
        /* @__PURE__ */ d.jsx(JE, { size: 28, strokeWidth: 1.5 }),
        /* @__PURE__ */ d.jsx("h2", { children: r ? "想怎样修改这段文字？" : "从一个想法开始" }),
        /* @__PURE__ */ d.jsx("p", { children: r ? "回复完成后更新节点文字，可撤销。" : "构思故事、打磨文案，或整理下一支视频的提示词。" }),
        /* @__PURE__ */ d.jsx("div", { className: "fm-chat-starters", children: (r ? ["润色这段文字", "改写成视频提示词"] : ["帮我构思一段视频脚本", "把灵感整理成拍摄提纲"]).map((oe) => /* @__PURE__ */ d.jsxs("button", { type: "button", onClick: () => {
          M(oe), Nt.current?.focus();
        }, children: [
          oe,
          /* @__PURE__ */ d.jsx(_c, { size: 14 })
        ] }, oe)) })
      ] }) }) }),
      he && /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-latest fm-chat-icon", "aria-label": "查看最新回复", onClick: () => {
        St.current = !0, bt.current?.scrollTo({ top: bt.current.scrollHeight, behavior: "smooth" }), Ee(!1);
      }, children: /* @__PURE__ */ d.jsx(hb, { size: 18 }) }),
      /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-compose-area", children: [
        L && /* @__PURE__ */ d.jsxs("section", { className: "fm-chat-canvas-picker", "aria-label": "放入画布", children: [
          /* @__PURE__ */ d.jsxs("header", { children: [
            /* @__PURE__ */ d.jsx("strong", { children: "放入画布" }),
            /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "取消放入画布", onClick: () => ce(null), children: /* @__PURE__ */ d.jsx(wi, { size: 16 }) })
          ] }),
          /* @__PURE__ */ d.jsxs("select", { "aria-label": "选择画布", value: le, onChange: (oe) => Te(oe.target.value), children: [
            /* @__PURE__ */ d.jsx("option", { value: "", children: "新建画布" }),
            pe.map((oe) => /* @__PURE__ */ d.jsx("option", { value: oe.id, children: oe.title }, oe.id))
          ] }),
          !le && /* @__PURE__ */ d.jsx("input", { "aria-label": "画布名称", value: Ce, maxLength: 80, onChange: (oe) => we(oe.target.value) }),
          /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-primary", disabled: R, onClick: () => {
            hn();
          }, children: "添加文本节点" })
        ] }),
        j && /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-notice", role: "status", children: [
          "对话已删除",
          /* @__PURE__ */ d.jsx("button", { type: "button", onClick: () => {
            xn();
          }, children: "撤销" }),
          /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "关闭删除提示", onClick: () => B(""), children: /* @__PURE__ */ d.jsx(wi, { size: 14 }) })
        ] }),
        O && /* @__PURE__ */ d.jsx("div", { className: "fm-chat-notice", role: "status", children: O }),
        I && /* @__PURE__ */ d.jsx("div", { className: "fm-chat-notice", role: "status", children: "正在重新连接，回复会在后台继续" }),
        V && /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-error", role: "alert", children: [
          /* @__PURE__ */ d.jsx("span", { children: V }),
          /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-icon", "aria-label": "关闭错误提示", onClick: () => k(""), children: /* @__PURE__ */ d.jsx(wi, { size: 16 }) })
        ] }),
        /* @__PURE__ */ d.jsxs("form", { className: "fm-chat-composer", onSubmit: (oe) => {
          oe.preventDefault(), vn && Lt();
        }, children: [
          /* @__PURE__ */ d.jsx("textarea", { ref: Nt, "aria-label": "发送消息", placeholder: _ ? r ? "说说你的修改想法…" : "发送消息…" : "暂无可用模型", value: D, maxLength: 12e3, rows: 2, onChange: (oe) => {
            M(oe.target.value), sessionStorage.setItem(m + "-draft-" + S, oe.target.value);
          }, onKeyDown: (oe) => {
            oe.key === "Enter" && !oe.shiftKey && !oe.nativeEvent.isComposing && (oe.preventDefault(), vn && D.trim() && Lt());
          } }),
          /* @__PURE__ */ d.jsxs("div", { className: "fm-chat-composer-bottom", children: [
            /* @__PURE__ */ d.jsx(Cp, { models: E?.models || {}, value: _, disabled: R || Me || Wt, onChange: C }),
            /* @__PURE__ */ d.jsx("span", { className: "fm-chat-cost", title: Tt != null ? `每条完整回复 ${Tt} 积分，可用 ${E?.credits.available}` : "该模型尚未定价", "aria-label": Tt != null ? `${Tt} 积分` : void 0, children: _ ? Tt == null ? "未定价" : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
              /* @__PURE__ */ d.jsx(lb, {}),
              Tt
            ] }) : null }),
            Wt ? /* @__PURE__ */ d.jsx("button", { type: "button", className: "fm-chat-send", "aria-label": "停止回复", onClick: () => {
              zn();
            }, disabled: R, children: /* @__PURE__ */ d.jsx(ip, { size: 15, fill: "currentColor" }) }) : /* @__PURE__ */ d.jsx("button", { type: "submit", className: "fm-chat-send", "aria-label": "发送", disabled: !vn || !D.trim(), children: /* @__PURE__ */ d.jsx(_c, { size: 21 }) })
          ] })
        ] }),
        _ && Tt != null && E && E.credits.available < Tt && !Wt && /* @__PURE__ */ d.jsx("p", { className: "fm-chat-balance", children: "当前空间积分不足" })
      ] })
    ] })
  ] });
}
function H4({ shots: n, onMove: a, onRemove: s, onSelect: r, onExport: o, renderNarration: f, composition: h }) {
  const [m, v] = A.useState(null), [y, g] = A.useState(!1), [p, S] = A.useState(""), w = n.filter((N) => N.media).length, E = !!n.length && w === n.length;
  return /* @__PURE__ */ d.jsxs("div", { className: "shot-editor", children: [
    /* @__PURE__ */ d.jsxs("div", { className: "shot-summary", children: [
      /* @__PURE__ */ d.jsx("span", { children: n.length ? `${w} / ${n.length} 个镜头已有视频 · 约 ${Math.round(n.reduce((N, _) => N + _.seconds, 0) * 10) / 10} 秒` : "选中视频节点，加入镜头列表开始编排。" }),
      !!n.length && /* @__PURE__ */ d.jsxs("button", { className: "secondary", disabled: !E || y, onClick: async () => {
        g(!0), S("");
        try {
          await o();
        } catch (N) {
          S(N.message);
        } finally {
          g(!1);
        }
      }, children: [
        /* @__PURE__ */ d.jsx(Xs, { size: 15 }),
        y ? "准备中…" : "导出镜头包"
      ] })
    ] }),
    !!n.length && /* @__PURE__ */ d.jsx("ol", { className: "shot-list", children: n.map((N, _) => /* @__PURE__ */ d.jsxs("li", { children: [
      /* @__PURE__ */ d.jsx("span", { className: "shot-index", children: String(_ + 1).padStart(2, "0") }),
      /* @__PURE__ */ d.jsxs("button", { className: "shot-link", onClick: () => r(N.id), children: [
        /* @__PURE__ */ d.jsx("strong", { children: N.title || "未命名镜头" }),
        /* @__PURE__ */ d.jsxs("small", { children: [
          Math.round(N.seconds * 10) / 10,
          " 秒 · ",
          N.adopted ? `已采用 #${N.adopted}` : N.media ? "当前视频" : N.status
        ] })
      ] }),
      /* @__PURE__ */ d.jsxs("div", { className: "shot-actions", children: [
        /* @__PURE__ */ d.jsx("button", { className: "icon-button", title: "旁白", "aria-label": `镜头 ${_ + 1} 的旁白`, "aria-expanded": m === N.id, onClick: () => v(m === N.id ? null : N.id), children: /* @__PURE__ */ d.jsx(Ap, { size: 16 }) }),
        /* @__PURE__ */ d.jsx("button", { className: "icon-button", title: "上移", "aria-label": `上移镜头 ${_ + 1}`, disabled: _ === 0 || y, onClick: () => a(N.id, -1), children: /* @__PURE__ */ d.jsx(_c, { size: 16 }) }),
        /* @__PURE__ */ d.jsx("button", { className: "icon-button", title: "下移", "aria-label": `下移镜头 ${_ + 1}`, disabled: _ === n.length - 1 || y, onClick: () => a(N.id, 1), children: /* @__PURE__ */ d.jsx(hb, { size: 16 }) }),
        /* @__PURE__ */ d.jsx("button", { className: "icon-button", title: "从列表移除", "aria-label": `移除镜头 ${_ + 1}`, disabled: y, onClick: () => s(N.id), children: /* @__PURE__ */ d.jsx(wi, { size: 16 }) })
      ] }),
      m === N.id && f(N)
    ] }, N.id)) }),
    p && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: p }),
    h
  ] });
}
function Wm(n) {
  const a = n.actual?.width && n.actual?.height ? `${n.actual.width} × ${n.actual.height}` : n.width && n.height ? `${n.width} × ${n.height}` : "—", s = n.model === "MiniMax H3";
  return [
    ["模型", n.model_label || (n.model === "muse-video" ? "Muse" : n.model)],
    ["画幅与尺寸", `${n.ratio} · ${a}`],
    ["时长", `${Math.round(yw(n) * 10) / 10} 秒`],
    ["参考图片", n.refs],
    ["采样", s ? n.sampling_steps === 4 ? "快速模式" : `${n.sampling_steps ?? 20} 步` : "—"],
    ["种子", s ? String(n.seed ?? "自动") : "—"],
    ["提示词", n.prompt]
  ];
}
function L4({ runs: n, adopted: a, onAdopt: s }) {
  const [r, o] = A.useState(n[0]?.id), [f, h] = A.useState(n.find((N) => N.id === a && N.id !== r)?.id ?? n[1]?.id), [m, v] = A.useState(""), y = A.useRef(null), g = A.useRef(null), p = n.find((N) => N.id === r), S = n.find((N) => N.id === f), w = async () => {
    const N = [y.current, g.current];
    if (N.some((_) => !_ || _.readyState < 1)) {
      v("视频正在加载，请稍后再试");
      return;
    }
    v("");
    try {
      await Promise.all(N.map((_) => (_.currentTime = 0, _.play())));
    } catch {
      N.forEach((_) => _?.pause()), v("无法同时播放，请检查视频是否可以播放");
    }
  };
  if (!p || !S) return /* @__PURE__ */ d.jsx("p", { children: "版本已变更，请关闭后重新打开对比。" });
  const E = [Wm(S), Wm(p)];
  return /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
    /* @__PURE__ */ d.jsxs("div", { className: "compare-actions", children: [
      /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: w, children: "从头同时播放" }),
      /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => {
        y.current?.pause(), g.current?.pause();
      }, children: "同时暂停" }),
      /* @__PURE__ */ d.jsx("span", { children: "有差异的参数会加粗显示" })
    ] }),
    m && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: m }),
    /* @__PURE__ */ d.jsx("div", { className: "version-compare", children: [p, S].map((N, _) => /* @__PURE__ */ d.jsxs("section", { "aria-label": _ === 0 ? "左侧版本" : "右侧版本", children: [
      /* @__PURE__ */ d.jsxs("label", { className: "version-select", children: [
        _ === 0 ? "版本 A" : "版本 B",
        /* @__PURE__ */ d.jsx("select", { value: N.id, onChange: (C) => {
          y.current?.pause(), g.current?.pause(), v(""), (_ === 0 ? o : h)(Number(C.target.value));
        }, children: n.map((C) => /* @__PURE__ */ d.jsxs("option", { value: C.id, disabled: C.id === (_ === 0 ? S.id : p.id), children: [
          "#",
          C.id,
          C.id === a ? " · 已采用" : ""
        ] }, C.id)) })
      ] }),
      /* @__PURE__ */ d.jsx(
        "video",
        {
          ref: _ === 0 ? y : g,
          src: "/media/" + N.result + "#t=0.05",
          controls: !0,
          playsInline: !0,
          muted: _ === 1,
          preload: "metadata"
        },
        N.id
      ),
      /* @__PURE__ */ d.jsx(
        "button",
        {
          className: N.id === a ? "secondary version-adopt" : "primary version-adopt",
          disabled: N.id === a,
          onClick: () => s(N.id),
          children: N.id === a ? "已采用" : "采用这一版"
        }
      ),
      /* @__PURE__ */ d.jsx("dl", { className: "version-specs", children: Wm(N).map(([C, D], M) => /* @__PURE__ */ d.jsxs("div", { className: JSON.stringify(D) === JSON.stringify(E[_][M][1]) ? "" : "different", children: [
        /* @__PURE__ */ d.jsx("dt", { children: C }),
        /* @__PURE__ */ d.jsx("dd", { children: Array.isArray(D) ? D.length ? /* @__PURE__ */ d.jsx("div", { className: "version-refs", children: D.map((R, Q) => /* @__PURE__ */ d.jsx("img", { src: "/media/" + R, alt: `参考图 ${Q + 1}`, loading: "lazy" }, R)) }) : "无" : D })
      ] }, C)) })
    ] }, _)) })
  ] });
}
function ep(n) {
  const a = n.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""), s = JSON.parse(a), r = Array.isArray(s) ? s : s.shots;
  if (!Array.isArray(r) || r.length < 1 || r.length > 12) throw new Error("需要 1–12 个镜头");
  return r.map((o) => {
    if (!o || typeof o.title != "string" || !o.title.trim() || o.title.length > 80 || typeof o.prompt != "string" || !o.prompt.trim() || o.prompt.length > 12e3 || typeof o.narration != "string" || o.narration.length > 300 || ![5, 10, 15].includes(o.seconds)) throw new Error("镜头格式不完整，请修改后重新读取");
    return { title: o.title, prompt: o.prompt, narration: o.narration, seconds: o.seconds };
  });
}
function U4({ workspace: n, userId: a, project: s, onApply: r }) {
  const o = `fm-storyboard-${a}-${n}-${s}`, [f, h] = A.useState(), [m, v] = A.useState(""), [y, g] = A.useState(() => localStorage.getItem(o + "-brief") || ""), [p, S] = A.useState(() => localStorage.getItem(o + "-chat") || ""), [w, E] = A.useState(() => {
    try {
      return ep(localStorage.getItem(o + "-proposal") || "[]");
    } catch {
      return [];
    }
  }), [N, _] = A.useState(!1), [C, D] = A.useState(!1), [M, R] = A.useState(""), [Q, V] = A.useState(!1), k = A.useRef(0), H = A.useRef(null), q = (te, O) => og(n, te, O), de = (te) => {
    h(te), v((O) => O in te.models ? O : Object.keys(te.models)[0] || "");
  };
  A.useEffect(() => {
    let te = !0;
    const O = () => q("/api/chat/config").then((j) => {
      te && de(j);
    }).catch((j) => {
      te && R(j.message);
    });
    O();
    const Y = setInterval(() => {
      O();
    }, 1e4);
    try {
      H.current = JSON.parse(localStorage.getItem(o + "-pending") || "null");
    } catch {
    }
    return () => {
      te = !1, clearInterval(Y);
    };
  }, [n]), A.useEffect(() => {
    if (!p) return;
    let te = !1;
    const O = (j) => {
      if (te) return;
      _(!!j.conversation.active_turn);
      const B = [...j.messages].reverse().find((X) => X.role === "assistant");
      if (B && B.state !== "running" && (H.current = null, localStorage.removeItem(o + "-pending"), k.current !== B.id)) {
        if (k.current = B.id, B.state !== "complete") {
          R(B.error || "生成未完成，积分已退回");
          return;
        }
        V(!0);
        try {
          E(ep(B.content)), R("");
        } catch {
          R("未能整理出完整分镜。请调整需求后重新拟定，已有分镜会保留。");
        }
      }
    };
    q("/api/chats/" + p).then(O).catch((j) => R(j.message));
    const Y = new EventSource("/api/chats/" + p + "/events?workspace=" + n);
    return Y.onmessage = (j) => O(JSON.parse(j.data)), () => {
      te = !0, Y.close();
    };
  }, [p, n]), A.useEffect(() => {
    w.length && localStorage.setItem(o + "-proposal", JSON.stringify(w));
  }, [w, o]);
  const ee = f?.pricing.items.find((te) => te.key === m + "|reply")?.amount, me = async () => {
    D(!0), R("");
    try {
      if (!H.current) {
        const j = await q("/api/chats", { model: m }), B = j.conversation.id;
        localStorage.setItem(o + "-chat", B), S(B);
        const X = `请根据下面需求拟定可编辑分镜，不要执行视频或语音生成。默认目标是 30 秒、6 个镜头。只返回 JSON 数组，1–12 个镜头，每项严格包含 title（简短标题）、prompt（可直接用于视频生成的中文镜头描述）、narration（可为空，按自然朗读每秒约2–3个汉字，5秒不超过12字、10秒不超过25字、15秒不超过35字）、seconds（只能为5、10、15）。保持主体和场景连贯，不编造需求没有提供的事实，不输出 Markdown。需求：
` + y;
        H.current = { cid: B, body: { uid: crypto.randomUUID(), model: m, text: X, expected_revision: j.conversation.revision, price_revision: f.pricing.revision } }, localStorage.setItem(o + "-pending", JSON.stringify(H.current));
      }
      const te = H.current;
      S(te.cid), V(!1);
      const O = await q("/api/chats/" + te.cid + "/messages", te.body);
      _(!!O.conversation.active_turn);
      const Y = [...O.messages].reverse().find((j) => j.role === "assistant");
      if (Y?.state === "complete") {
        V(!0);
        try {
          E(ep(Y.content));
        } catch {
          R("未能整理出完整分镜。请调整需求后重新拟定，已有分镜会保留。");
        }
      }
    } catch (te) {
      te.status && te.status < 500 && (H.current = null, localStorage.removeItem(o + "-pending"), q("/api/chat/config").then(de)), R(te.message);
    } finally {
      D(!1);
    }
  };
  return /* @__PURE__ */ d.jsxs("div", { className: "ai-storyboard", children: [
    /* @__PURE__ */ d.jsxs("label", { children: [
      "创作需求",
      /* @__PURE__ */ d.jsx("textarea", { value: y, maxLength: 8e3, rows: 4, disabled: N || C, placeholder: "介绍活动主题、受众、地点和希望传达的信息…", onChange: (te) => {
        g(te.target.value), localStorage.setItem(o + "-brief", te.target.value);
      } })
    ] }),
    /* @__PURE__ */ d.jsxs("div", { className: "storyboard-request", children: [
      /* @__PURE__ */ d.jsx(Cp, { models: f?.models || {}, value: m, disabled: C || N, onChange: v }),
      /* @__PURE__ */ d.jsx("span", { children: ee == null ? "" : `文字生成 · ${ee}` }),
      N ? /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => {
        q("/api/chats/" + p + "/stop", {}).catch((te) => R(te.message));
      }, children: "停止" }) : /* @__PURE__ */ d.jsx("button", { className: "primary", disabled: C || !y.trim() || !m || !f?.models[m] || ee == null || f?.credits.available < ee, onClick: () => {
        me();
      }, children: C ? "提交中…" : H.current ? "重试确认" : Q && M ? `重新拟定 · ${ee}` : "拟定分镜" })
    ] }),
    M && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: M }),
    !!w.length && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
      /* @__PURE__ */ d.jsx("div", { className: "storyboard-proposal", children: w.map((te, O) => /* @__PURE__ */ d.jsxs("section", { children: [
        /* @__PURE__ */ d.jsxs("label", { children: [
          "镜头 ",
          O + 1,
          /* @__PURE__ */ d.jsx("input", { value: te.title, maxLength: 80, onChange: (Y) => E((j) => j.map((B, X) => X === O ? { ...B, title: Y.target.value } : B)) })
        ] }),
        /* @__PURE__ */ d.jsxs("label", { children: [
          "画面",
          /* @__PURE__ */ d.jsx("textarea", { rows: 3, value: te.prompt, maxLength: 12e3, onChange: (Y) => E((j) => j.map((B, X) => X === O ? { ...B, prompt: Y.target.value } : B)) })
        ] }),
        /* @__PURE__ */ d.jsxs("label", { children: [
          "旁白",
          /* @__PURE__ */ d.jsx("textarea", { rows: 2, maxLength: 300, value: te.narration, onChange: (Y) => E((j) => j.map((B, X) => X === O ? { ...B, narration: Y.target.value } : B)) })
        ] }),
        /* @__PURE__ */ d.jsx("div", { className: "storyboard-seconds", role: "group", "aria-label": `镜头 ${O + 1} 时长`, children: [5, 10, 15].map((Y) => /* @__PURE__ */ d.jsxs("button", { "aria-pressed": te.seconds === Y, onClick: () => E((j) => j.map((B, X) => X === O ? { ...B, seconds: Y } : B)), children: [
          Y,
          "s"
        ] }, Y)) })
      ] }, O)) }),
      /* @__PURE__ */ d.jsxs("div", { className: "dialog-actions", children: [
        /* @__PURE__ */ d.jsxs("span", { children: [
          w.length,
          " 个镜头 · ",
          w.reduce((te, O) => te + O.seconds, 0),
          " 秒"
        ] }),
        /* @__PURE__ */ d.jsx("button", { className: "primary", disabled: C || w.some((te) => !te.title.trim() || !te.prompt.trim()), onClick: async () => {
          D(!0);
          try {
            await r(w);
          } catch (te) {
            R(te.message);
          } finally {
            D(!1);
          }
        }, children: "采用分镜，不生成视频" })
      ] })
    ] })
  ] });
}
function B4({ node: n, runs: a, cost: s, unavailableReason: r, onChange: o, onGenerate: f }) {
  const [h, m] = A.useState(!1), [v, y] = A.useState(""), g = a.find((_) => _.id === n.narration_job), p = a.find((_) => _.id === n.narration_pending), S = a.some((_) => _.canvas_node === "voice:" + n.id && ["queued", "running"].includes(_.status)), w = p && ["failed", "cancelled"].includes(p.status), E = p?.status === "done" && p.result, N = g?.status === "done" && g.prompt.trim() !== (n.narration_text || "").trim();
  return /* @__PURE__ */ d.jsxs("div", { className: "shot-narration", onClick: (_) => _.stopPropagation(), children: [
    /* @__PURE__ */ d.jsxs("label", { children: [
      "旁白文字",
      /* @__PURE__ */ d.jsx("textarea", { rows: 3, maxLength: 300, value: n.narration_text || "", placeholder: "这一镜头要讲什么？", onChange: (_) => o({ narration_text: _.target.value }) })
    ] }),
    /* @__PURE__ */ d.jsxs("label", { children: [
      "音色描述",
      /* @__PURE__ */ d.jsx("input", { maxLength: 300, value: n.narration_instruction || "", placeholder: "清晰自然的普通话，语速适中", onChange: (_) => o({ narration_instruction: _.target.value }) })
    ] }),
    g?.status === "done" && g.result && /* @__PURE__ */ d.jsx("audio", { "aria-label": "当前旁白", src: "/media/" + g.result, controls: !0, preload: "metadata" }),
    N && /* @__PURE__ */ d.jsx("p", { children: "文字已修改，重新生成后更新旁白。" }),
    S && /* @__PURE__ */ d.jsxs("p", { role: "status", children: [
      p?.status === "running" ? "正在生成旁白" : "旁白已加入队列",
      g?.result ? "，当前音轨会保留至新旁白完成。" : ""
    ] }),
    w && /* @__PURE__ */ d.jsxs("p", { className: "error", role: "alert", children: [
      p.status === "cancelled" ? "旁白已取消，积分已退回。" : (p.note || "旁白生成失败") + "，积分已退回。",
      g?.result ? "当前仍保留上一段旁白。" : ""
    ] }),
    E && /* @__PURE__ */ d.jsxs("div", { children: [
      /* @__PURE__ */ d.jsx("p", { children: "生成期间文稿或音色描述发生了变化。" }),
      /* @__PURE__ */ d.jsx("audio", { "aria-label": "待采用旁白", src: "/media/" + p.result, controls: !0 }),
      /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => o({ narration_job: p.id, narration_pending: null, narration_text: p.prompt, narration_instruction: p.inputs?.instruction || "" }), children: "使用生成时的文稿与旁白" })
    ] }),
    !!r && /* @__PURE__ */ d.jsx("p", { role: "status", children: r }),
    v && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: v }),
    /* @__PURE__ */ d.jsxs("div", { className: "narration-actions", children: [
      (n.narration_job || n.narration_text || n.narration_pending) && /* @__PURE__ */ d.jsxs("button", { className: "secondary", disabled: h || S, onClick: () => o({ narration_job: null, narration_pending: null, narration_text: "", narration_instruction: "" }), children: [
        /* @__PURE__ */ d.jsx(wi, { size: 14 }),
        "移除旁白"
      ] }),
      /* @__PURE__ */ d.jsxs("button", { className: "secondary", disabled: h || S || !n.narration_text?.trim() || !!r || s === null, onClick: async () => {
        m(!0), y("");
        try {
          await f();
        } catch (_) {
          y(_.message);
        } finally {
          m(!1);
        }
      }, children: [
        /* @__PURE__ */ d.jsx(Ap, { size: 15 }),
        S ? "旁白生成中" : h ? "提交中…" : `${w ? "重新生成" : "生成旁白"} · ${s ?? "未定价"}`
      ] })
    ] })
  ] });
}
function $4({ project: n, getRevision: a, ready: s, waitingReason: r }) {
  const [o, f] = A.useState([]), [h, m] = A.useState(!1), [v, y] = A.useState(""), [g, p] = A.useState(null), S = async () => {
    const N = await ln(`/api/canvases/${n}/exports`);
    f(N.exports);
  };
  A.useEffect(() => {
    let N = !0;
    const _ = async () => {
      try {
        const D = await ln(`/api/canvases/${n}/exports`);
        N && f(D.exports);
      } catch (D) {
        N && y(D.message);
      }
    };
    _();
    const C = setInterval(_, 5e3);
    return () => {
      N = !1, clearInterval(C);
    };
  }, [n]);
  const w = o.some((N) => ["queued", "running"].includes(N.state)), E = async () => {
    m(!0), y("");
    const N = "fm-compose-" + n;
    try {
      const _ = await a();
      let C;
      try {
        C = JSON.parse(localStorage.getItem(N) || "null");
      } catch {
      }
      C || (C = { uid: crypto.randomUUID(), expected_revision: _ }, localStorage.setItem(N, JSON.stringify(C)));
      try {
        await ln(`/api/canvases/${n}/exports`, C), localStorage.removeItem(N);
      } catch (D) {
        throw D instanceof Wr && D.status < 500 && localStorage.removeItem(N), D;
      }
      await S();
    } catch (_) {
      y(_.message);
    } finally {
      m(!1);
    }
  };
  return /* @__PURE__ */ d.jsxs("section", { className: "shot-composition", "aria-label": "成片预览与导出", children: [
    /* @__PURE__ */ d.jsxs("div", { className: "composition-heading", children: [
      /* @__PURE__ */ d.jsx("h3", { children: "成片" }),
      /* @__PURE__ */ d.jsxs("button", { className: "primary", disabled: h || w || !s, onClick: () => {
        E();
      }, children: [
        /* @__PURE__ */ d.jsx(Jr, { size: 16 }),
        w ? "合成中…" : h ? "提交中…" : "合成预览"
      ] })
    ] }),
    /* @__PURE__ */ d.jsx("p", { children: "旁白替换对应镜头的原音轨，较长的旁白会延长尾帧停留。字幕按句分配时间，可下载调整。" }),
    !s && r && /* @__PURE__ */ d.jsx("p", { role: "status", children: r }),
    v && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: v }),
    /* @__PURE__ */ d.jsx("div", { className: "composition-results", children: o.slice(0, 5).map((N) => /* @__PURE__ */ d.jsxs("div", { children: [
      /* @__PURE__ */ d.jsxs("div", { className: "composition-result", children: [
        /* @__PURE__ */ d.jsxs("span", { children: [
          new Date(N.created * 1e3).toLocaleString(),
          /* @__PURE__ */ d.jsxs("small", { children: [
            "版本 ",
            N.revision
          ] })
        ] }),
        N.state === "done" && N.result ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
          /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => p(g === N.id ? null : N.id), children: g === N.id ? "收起预览" : "预览" }),
          /* @__PURE__ */ d.jsxs("a", { className: "secondary", href: "/media/" + N.result + "?download=true", children: [
            /* @__PURE__ */ d.jsx(Xs, { size: 15 }),
            "MP4"
          ] }),
          /* @__PURE__ */ d.jsx("a", { className: "secondary", href: "/api/storyboard-exports/" + N.id + "/subtitles", children: "字幕 SRT" })
        ] }) : /* @__PURE__ */ d.jsx("span", { children: N.state === "queued" ? "等待合成" : N.state === "running" ? "正在合成" : N.state === "failed" ? N.error : "成片已删除" })
      ] }),
      g === N.id && N.result && /* @__PURE__ */ d.jsx("video", { className: "composition-preview", src: "/media/" + N.result, controls: !0, playsInline: !0, children: /* @__PURE__ */ d.jsx("track", { kind: "captions", label: "旁白字幕", srcLang: "zh", src: "/api/storyboard-exports/" + N.id + "/subtitles?format=vtt", default: !0 }) })
    ] }, N.id)) })
  ] });
}
const tp = { subject: "人物外观", outfit: "服装", scene: "场景", style: "风格", product: "产品细节" }, sb = () => ({ name: "", purpose: "subject", description: "", media: [] });
function q4({ workspace: n, userId: a, admin: s = !1, selected: r = [], imageRefs: o = [], onImportImages: f, onImportPack: h, onRemovePack: m }) {
  const [v, y] = A.useState([]), [g, p] = A.useState([]), [S, w] = A.useState(null), [E, N] = A.useState([]), [_, C] = A.useState(), [D, M] = A.useState(sb), [R, Q] = A.useState(!0), [V, k] = A.useState(!1), [H, q] = A.useState(""), [de, ee] = A.useState(null), me = async (I, ae, he = ae === void 0 ? "GET" : "POST", Ee) => {
    const L = await fetch(I, { method: he, signal: Ee, headers: { "X-Workspace-Id": String(n), ...ae === void 0 ? {} : { "Content-Type": "application/json" } }, body: ae === void 0 ? void 0 : JSON.stringify(ae) }), ce = await L.json();
    if (!L.ok) throw new Error(typeof ce.detail == "string" ? ce.detail : "请求失败，请重试");
    return ce;
  }, te = async (I) => {
    Q(!0), q("");
    try {
      const [ae, he] = await Promise.all([me("/api/asset-packs", void 0, "GET", I), me("/api/state", void 0, "GET", I)]);
      I?.aborted || (y(ae.packs), p(he.assets.filter((Ee) => !Ee.kind || Ee.kind === "ref")));
    } catch (ae) {
      I?.aborted || q(ae.message);
    } finally {
      I?.aborted || Q(!1);
    }
  };
  A.useEffect(() => {
    const I = new AbortController();
    return w(null), N([]), C(void 0), te(I.signal), () => I.abort();
  }, [n]);
  const O = async () => {
    k(!0), q("");
    try {
      await me("/api/asset-packs" + (_ ? "/" + _.id : ""), { ...D, expected_revision: _?.revision }, _ ? "PUT" : "POST"), C(void 0), await te();
    } catch (I) {
      q(I.message);
    } finally {
      k(!1);
    }
  }, Y = async (I) => {
    if (I) {
      k(!0), q("");
      try {
        const ae = await fetch("/api/assets", { method: "POST", headers: { "X-Workspace-Id": String(n) }, body: I }), he = await ae.json();
        if (!ae.ok) throw new Error(typeof he.detail == "string" ? he.detail : "上传失败");
        p((Ee) => [he, ...Ee]), M((Ee) => ({ ...Ee, media: [...Ee.media, he.id].slice(0, 9) }));
      } catch (ae) {
        q(ae.message);
      } finally {
        k(!1);
      }
    }
  }, j = async (I) => {
    k(!0), q("");
    try {
      await I();
    } catch (ae) {
      q(ae.message);
    } finally {
      k(!1);
    }
  }, B = (I) => M((ae) => ({ ...ae, media: ae.media.includes(I) ? ae.media.filter((he) => he !== I) : ae.media.length < 9 ? [...ae.media, I] : ae.media })), X = v.find((I) => I.id === S), J = r.find((I) => I.id === S);
  return /* @__PURE__ */ d.jsxs("div", { className: "fm-packs", "aria-busy": V || R, children: [
    H && /* @__PURE__ */ d.jsx("p", { role: "alert", className: "fm-pack-error", children: H }),
    _ !== void 0 ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
      /* @__PURE__ */ d.jsxs("button", { className: "fm-pack-button", disabled: V, onClick: () => {
        C(void 0), q("");
      }, children: [
        /* @__PURE__ */ d.jsx(Cf, { size: 16 }),
        "返回素材包"
      ] }),
      /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-fields", children: [
        /* @__PURE__ */ d.jsxs("label", { children: [
          "名称",
          /* @__PURE__ */ d.jsx("input", { value: D.name, maxLength: 60, placeholder: "例如：主角 A、展台场景", onChange: (I) => M({ ...D, name: I.target.value }) })
        ] }),
        /* @__PURE__ */ d.jsxs("fieldset", { children: [
          /* @__PURE__ */ d.jsx("legend", { children: "用途" }),
          /* @__PURE__ */ d.jsx("div", { className: "fm-pack-purpose", children: Object.entries(tp).map(([I, ae]) => /* @__PURE__ */ d.jsx("button", { "aria-pressed": D.purpose === I, onClick: () => M({ ...D, purpose: I }), children: ae }, I)) })
        ] }),
        /* @__PURE__ */ d.jsxs("label", { children: [
          "说明",
          /* @__PURE__ */ d.jsx("textarea", { value: D.description, maxLength: 2e3, rows: 3, placeholder: "人物特征、服装或场景中需要保留的细节", onChange: (I) => M({ ...D, description: I.target.value }) })
        ] })
      ] }),
      /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-heading", children: [
        /* @__PURE__ */ d.jsxs("span", { children: [
          "参考图片 · ",
          D.media.length,
          "/9"
        ] }),
        /* @__PURE__ */ d.jsxs("label", { className: "fm-pack-button", children: [
          /* @__PURE__ */ d.jsx(lp, { size: 16 }),
          "上传图片",
          /* @__PURE__ */ d.jsx("input", { type: "file", hidden: !0, accept: "image/*,.heic,.heif", disabled: V || D.media.length >= 9, onChange: (I) => {
            Y(I.target.files?.[0]);
          } })
        ] })
      ] }),
      /* @__PURE__ */ d.jsx("div", { className: "fm-pack-images", children: g.map((I) => /* @__PURE__ */ d.jsxs("button", { disabled: V, "aria-label": "选择参考图 " + I.id.slice(0, 6), "aria-pressed": D.media.includes(I.id), onClick: () => B(I.id), children: [
        /* @__PURE__ */ d.jsx("img", { loading: "lazy", src: "/media/" + I.id, alt: "参考图" }),
        D.media.includes(I.id) && /* @__PURE__ */ d.jsx("span", { children: D.media.indexOf(I.id) + 1 })
      ] }, I.id)) }),
      !g.length && /* @__PURE__ */ d.jsx("p", { children: "上传图片，建立这个素材包。" }),
      /* @__PURE__ */ d.jsx("div", { className: "fm-pack-footer", children: /* @__PURE__ */ d.jsx("button", { className: "fm-pack-primary", disabled: V || !D.name.trim() || !D.media.length, onClick: () => {
        O();
      }, children: V ? "保存中…" : "保存素材包" }) })
    ] }) : X ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
      /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-detail-heading", children: [
        /* @__PURE__ */ d.jsx("button", { className: "fm-pack-button", disabled: V, "aria-label": "返回素材包列表", onClick: () => {
          w(null), N([]), q("");
        }, children: /* @__PURE__ */ d.jsx(Cf, { size: 18 }) }),
        /* @__PURE__ */ d.jsxs("div", { children: [
          /* @__PURE__ */ d.jsx("h3", { children: X.name }),
          /* @__PURE__ */ d.jsxs("p", { children: [
            tp[X.purpose],
            " · ",
            X.media.length,
            " 张图片"
          ] })
        ] })
      ] }),
      X.description && /* @__PURE__ */ d.jsx("p", { className: "fm-pack-description", children: X.description }),
      /* @__PURE__ */ d.jsx("div", { className: "fm-pack-images fm-pack-pick-images", role: "group", "aria-label": "选择素材包图片", children: X.media.map((I, ae) => {
        const he = o.includes(I), Ee = E.includes(I);
        return /* @__PURE__ */ d.jsxs("button", { disabled: V || he, "aria-label": `${X.name} · 图片 ${ae + 1}${he ? "，已添加" : ""}`, "aria-pressed": he || Ee, onClick: () => {
          q(""), N((L) => Ee ? L.filter((ce) => ce !== I) : [...L, I]);
        }, children: [
          /* @__PURE__ */ d.jsx("img", { loading: "lazy", src: "/media/" + I, alt: `${X.name} · 图片 ${ae + 1}` }),
          (he || Ee) && /* @__PURE__ */ d.jsx("span", { children: he ? /* @__PURE__ */ d.jsx(pi, { size: 14 }) : E.indexOf(I) + 1 }),
          he && /* @__PURE__ */ d.jsx("small", { children: "已添加" })
        ] }, I);
      }) }),
      /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-import-footer", children: [
        /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-whole-actions", children: [
          /* @__PURE__ */ d.jsx("button", { className: "fm-pack-button", disabled: V || R || J?.revision === X.revision, onClick: () => {
            j(() => h(X));
          }, children: J ? J.revision === X.revision ? "已导入整包" : "更新整包引用" : "导入整个素材包" }),
          J && /* @__PURE__ */ d.jsx("button", { className: "fm-pack-button", disabled: V, onClick: () => {
            j(() => m(X.id));
          }, children: "移除整包引用" })
        ] }),
        /* @__PURE__ */ d.jsxs("button", { className: "fm-pack-primary", disabled: V || !E.length, onClick: () => {
          j(() => f(E, X));
        }, children: [
          "导入所选图片",
          E.length ? ` · ${E.length}` : ""
        ] })
      ] })
    ] }) : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
      /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-heading", children: [
        /* @__PURE__ */ d.jsx("span", { children: "选择素材包" }),
        /* @__PURE__ */ d.jsxs("button", { className: "fm-pack-button", disabled: V, onClick: () => {
          M(sb()), C(null), q("");
        }, children: [
          /* @__PURE__ */ d.jsx(La, { size: 16 }),
          "新建素材包"
        ] })
      ] }),
      R ? /* @__PURE__ */ d.jsx("p", { role: "status", children: "正在加载素材包…" }) : v.length === 0 ? /* @__PURE__ */ d.jsx("p", { className: "fm-pack-empty", children: "暂无素材包" }) : /* @__PURE__ */ d.jsx("div", { className: "fm-pack-list", children: v.map((I) => /* @__PURE__ */ d.jsxs("article", { children: [
        /* @__PURE__ */ d.jsxs("button", { className: "fm-pack-select", disabled: V, "aria-label": "打开素材包 " + I.name, onClick: () => {
          w(I.id), N([]), ee(null), q("");
        }, children: [
          /* @__PURE__ */ d.jsx("img", { loading: "lazy", src: "/media/" + I.media[0], alt: "" }),
          /* @__PURE__ */ d.jsxs("span", { children: [
            /* @__PURE__ */ d.jsx("strong", { children: I.name }),
            /* @__PURE__ */ d.jsxs("small", { children: [
              tp[I.purpose],
              " · ",
              I.media.length,
              " 张图片",
              r.some((ae) => ae.id === I.id) ? " · 已导入整包" : ""
            ] }),
            I.description && /* @__PURE__ */ d.jsx("p", { children: I.description })
          ] }),
          /* @__PURE__ */ d.jsx(pb, { size: 18 })
        ] }),
        /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-row-actions", children: [
          /* @__PURE__ */ d.jsx("button", { className: "fm-pack-button", disabled: V, "aria-label": "编辑 " + I.name, onClick: () => {
            C(I), M({ name: I.name, purpose: I.purpose, description: I.description, media: I.media }), q("");
          }, children: /* @__PURE__ */ d.jsx(Mp, { size: 16 }) }),
          (s || I.owner === a) && /* @__PURE__ */ d.jsx("button", { className: "fm-pack-button", disabled: V, "aria-label": "删除 " + I.name, onClick: () => ee(I.id), children: /* @__PURE__ */ d.jsx(Qs, { size: 16 }) })
        ] }),
        de === I.id && /* @__PURE__ */ d.jsxs("div", { className: "fm-pack-delete", children: [
          /* @__PURE__ */ d.jsxs("span", { children: [
            "删除“",
            I.name,
            "”？原图片会保留。"
          ] }),
          /* @__PURE__ */ d.jsx("button", { disabled: V, onClick: async () => {
            k(!0);
            try {
              await me("/api/asset-packs/" + I.id, void 0, "DELETE"), ee(null), await te();
            } catch (ae) {
              q(ae.message);
            } finally {
              k(!1);
            }
          }, children: "删除素材包" }),
          /* @__PURE__ */ d.jsx("button", { disabled: V, onClick: () => ee(null), children: "取消" })
        ] })
      ] }, I.id)) })
    ] })
  ] });
}
async function V4(n) {
  if (n.readyState < 2 || n.seeking || !n.videoWidth || !n.videoHeight)
    throw new Error("请等画面加载完毕再取帧");
  n.pause();
  const a = document.createElement("canvas");
  a.width = n.videoWidth, a.height = n.videoHeight;
  const s = a.getContext("2d");
  if (!s) throw new Error("当前浏览器无法提取视频画面");
  s.drawImage(n, 0, 0);
  const r = await new Promise((o) => a.toBlob(o, "image/jpeg", 0.95));
  if (!r) throw new Error("无法提取当前画面，请重试");
  return new File([r], "视频取帧.jpg", { type: "image/jpeg" });
}
const Y4 = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/avif,image/tiff,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif", I4 = (n) => /\.(jpe?g|png|webp|heic|heif|avif|tiff?|bmp|gif)$/i.test(n.name) || ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "image/avif", "image/tiff", "image/bmp", "image/x-ms-bmp", "image/gif"].includes(n.type), wc = {
  text: ap,
  image: xf,
  video: Jr,
  sticky: xN
};
function gc(n, a, s, r = 360, o = 280) {
  const f = a;
  for (let h = 0; h < 200; h++) {
    if (!n.some(
      (m) => a < m.x + m.width + 48 && a + r + 48 > m.x && s < m.y + m.height + 48 && s + o + 48 > m.y
    ))
      return { x: a, y: s };
    a += r + 100, h % 3 === 2 && (a = f, s += o + 90);
  }
  return { x: a, y: s };
}
const Nf = {
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "生成失败",
  cancelled: "已取消"
}, X4 = ["none", "mint", "blue", "purple", "orange", "yellow"], rb = ["无标签", "青绿", "蓝色", "紫色", "橙色", "黄色"], Si = (n) => "/media/" + n;
function pt({
  icon: n,
  label: a,
  active: s = !1,
  children: r,
  ...o
}) {
  return /* @__PURE__ */ d.jsxs(
    "button",
    {
      type: "button",
      className: "icon-button " + (s ? "active" : ""),
      title: a,
      "aria-label": a,
      "aria-pressed": s || void 0,
      ...o,
      children: [
        /* @__PURE__ */ d.jsx(n, { size: 18 }),
        r
      ]
    }
  );
}
function Di({
  title: n,
  children: a,
  onClose: s,
  wide: r = !1
}) {
  const o = A.useRef(null);
  return A.useEffect(() => {
    o.current?.showModal();
  }, []), /* @__PURE__ */ d.jsxs(
    "dialog",
    {
      ref: o,
      className: "cv-dialog " + (r ? "wide" : ""),
      onCancel: (f) => {
        f.preventDefault(), s();
      },
      onClick: (f) => {
        if (f.target === o.current) {
          const h = o.current.getBoundingClientRect();
          (f.clientX < h.left || f.clientX > h.right || f.clientY < h.top || f.clientY > h.bottom) && s();
        }
      },
      "aria-label": n,
      children: [
        /* @__PURE__ */ d.jsxs("div", { className: "dialog-head", children: [
          /* @__PURE__ */ d.jsx("h2", { children: n }),
          /* @__PURE__ */ d.jsx(pt, { icon: wi, label: "关闭", onClick: s })
        ] }),
        a
      ]
    }
  );
}
function Dw() {
  return /* @__PURE__ */ d.jsx("a", { className: "cv-brand", href: sl("/studio"), title: "返回工作台", "aria-label": "返回工作台", children: /* @__PURE__ */ d.jsx("img", { src: "/static/mark.svg", alt: "弗淼 AIGC" }) });
}
function ob(n) {
  const a = n >= 3600 ? 60 : n >= 60 ? 15 : 5, s = Math.max(5, Math.round(Math.max(0, n) / a) * a), r = Math.floor(s / 3600), o = Math.floor(s % 3600 / 60), f = s % 60;
  return [r ? `${r} 小时` : "", o ? `${o} 分` : "", f ? `${f} 秒` : ""].filter(Boolean).join(" ");
}
function Hw(n) {
  if (!n) return "";
  const a = n.eta || {};
  return n.status === "queued" ? a.reason === "waiting_gpu" ? "等待 GPU 上线" : a.reason === "service_paused" ? "等待图片服务开启" : a.reason === "observing" ? "观测中" : Number.isFinite(a.high) ? (a.median ?? a.high) > 0 ? `预计约 ${ob(a.median ?? a.high)}后开始` : "等待开始" : "排队中" : n.status === "running" ? a.phase === "uploading" ? "正在回传" : a.phase === "validating" ? "正在校验" : a.phase === "finalizing" ? "正在整理成片" : a.overdue ? "生成时间较长，仍在处理中" : Number.isFinite(a.high) ? (a.median ?? a.high) > 0 ? `预计还需约 ${ob(a.median ?? a.high)}` : "仍在生成，请稍候" : "正在生成" : Nf[n.status] || "";
}
function G4() {
  const [n, a] = A.useState(
    document.documentElement.dataset.theme || "light"
  );
  return A.useEffect(() => {
    const s = new MutationObserver(
      () => a(document.documentElement.dataset.theme || "light")
    );
    return s.observe(document.documentElement, {
      attributes: !0,
      attributeFilter: ["data-theme"]
    }), () => s.disconnect();
  }, []), n === "dark" ? "dark" : "light";
}
function Z4({ studio: n }) {
  const [a, s] = A.useState([]), [r, o] = A.useState(!0), [f, h] = A.useState(""), [m, v] = A.useState(!1), [y, g] = A.useState(""), [p, S] = A.useState(null), w = () => ln("/api/canvases").then((_) => {
    s(_.projects);
  }).catch((_) => g(_.message)).finally(() => o(!1));
  A.useEffect(() => {
    w();
  }, []);
  const E = async () => {
    v(!0), g("");
    try {
      const _ = await ln("/api/canvases", {});
      location.assign(sl("/canvas/" + _.id));
    } catch (_) {
      g(_.message), v(!1);
    }
  }, N = async (_) => {
    v(!0);
    try {
      const C = await ln(`/api/canvases/${_.id}/duplicate`, {});
      location.assign(sl("/canvas/" + C.id));
    } catch (C) {
      g(C.message), v(!1);
    }
  };
  return /* @__PURE__ */ d.jsxs("main", { className: "project-list", children: [
    /* @__PURE__ */ d.jsxs("header", { className: "list-header", children: [
      /* @__PURE__ */ d.jsxs("div", { children: [
        /* @__PURE__ */ d.jsx(Dw, {}),
        /* @__PURE__ */ d.jsxs("a", { href: sl("/studio"), className: "back-link", children: [
          /* @__PURE__ */ d.jsx(Cf, { size: 16 }),
          "工作台"
        ] })
      ] }),
      /* @__PURE__ */ d.jsx("span", { children: n.me.nickname || n.me.name })
    ] }),
    /* @__PURE__ */ d.jsxs("div", { className: "project-list-body", children: [
      /* @__PURE__ */ d.jsxs("div", { className: "project-list-heading", children: [
        /* @__PURE__ */ d.jsx("h1", { children: "画布" }),
        /* @__PURE__ */ d.jsxs("button", { className: "primary", disabled: m, onClick: () => E(), children: [
          /* @__PURE__ */ d.jsx(La, { size: 18 }),
          "新建画布"
        ] })
      ] }),
      a.length > 0 && /* @__PURE__ */ d.jsxs("div", { className: "list-search", children: [
        /* @__PURE__ */ d.jsx(np, { size: 17 }),
        /* @__PURE__ */ d.jsx(
          "input",
          {
            "aria-label": "搜索画布",
            placeholder: "搜索画布",
            value: f,
            onChange: (_) => h(_.target.value)
          }
        )
      ] }),
      y && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: y }),
      r ? /* @__PURE__ */ d.jsx("div", { className: "empty", children: "正在加载画布" }) : a.length ? /* @__PURE__ */ d.jsx("div", { className: "project-grid", children: a.filter(
        (_) => _.title.toLowerCase().includes(f.toLowerCase())
      ).map((_) => /* @__PURE__ */ d.jsxs("article", { className: "project-card", children: [
        /* @__PURE__ */ d.jsx(
          "a",
          {
            href: sl("/canvas/" + _.id),
            className: "project-cover",
            "aria-label": "打开画布 " + _.title,
            children: _.covers?.length ? /* @__PURE__ */ d.jsx("div", { className: "cover-grid count-" + _.covers.length, children: _.covers.map(
              (C) => C.type === "video" ? /* @__PURE__ */ d.jsx(
                "video",
                {
                  src: Si(C.id) + "#t=0.05",
                  muted: !0,
                  preload: "metadata"
                },
                C.id
              ) : /* @__PURE__ */ d.jsx(
                "img",
                {
                  src: Si(C.id),
                  alt: "",
                  loading: "lazy"
                },
                C.id
              )
            ) }) : /* @__PURE__ */ d.jsx(Af, { size: 32 })
          }
        ),
        /* @__PURE__ */ d.jsxs("div", { className: "project-card-info", children: [
          /* @__PURE__ */ d.jsxs("a", { href: sl("/canvas/" + _.id), children: [
            /* @__PURE__ */ d.jsx("strong", { children: _.title }),
            /* @__PURE__ */ d.jsxs("span", { children: [
              _.count,
              " 个节点 ·",
              " ",
              new Date(_.updated * 1e3).toLocaleDateString()
            ] })
          ] }),
          /* @__PURE__ */ d.jsxs("div", { className: "project-actions", children: [
            /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: Pr,
                label: "复制画布 " + _.title,
                onClick: () => N(_),
                disabled: m
              }
            ),
            _.can_delete && /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: Qs,
                label: "删除画布 " + _.title,
                onClick: () => S(_)
              }
            )
          ] })
        ] })
      ] }, _.id)) }) : /* @__PURE__ */ d.jsxs("div", { className: "project-empty", children: [
        /* @__PURE__ */ d.jsx(Af, { size: 40 }),
        /* @__PURE__ */ d.jsx("h2", { children: "从一张画布开始" }),
        /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => E(), disabled: m, children: "新建画布" })
      ] })
    ] }),
    p && /* @__PURE__ */ d.jsxs(
      Di,
      {
        title: "删除“" + p.title + "”？",
        onClose: () => S(null),
        children: [
          /* @__PURE__ */ d.jsx("p", { children: "素材和已经提交的任务会保留。" }),
          /* @__PURE__ */ d.jsxs("div", { className: "dialog-actions", children: [
            /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => S(null), children: "取消" }),
            /* @__PURE__ */ d.jsx(
              "button",
              {
                className: "primary danger",
                onClick: async () => {
                  try {
                    await ln(
                      `/api/canvases/${p.id}`,
                      void 0,
                      "DELETE"
                    ), S(null), await w();
                  } catch (_) {
                    g(_.message);
                  }
                },
                children: "删除画布"
              }
            )
          ] })
        ]
      }
    )
  ] });
}
const Lw = A.createContext(null), Q4 = A.memo(function({
  data: a,
  selected: s
}) {
  const { item: r, media: o, run: f } = a, h = A.useContext(Lw), m = wc[r.type], v = r.type === "text" || r.type === "sticky", y = h.editing === r.id;
  return /* @__PURE__ */ d.jsxs(
    "div",
    {
      className: "content-node kind-" + r.type + (s ? " selected" : "") + " tag-" + r.color,
      style: { "--zoom": h.zoom },
      children: [
        /* @__PURE__ */ d.jsx(
          Zk,
          {
            isVisible: s && v && !y,
            minWidth: 200,
            minHeight: 140,
            maxWidth: 1e3,
            maxHeight: 1e3,
            onResizeStart: h.begin,
            onResizeEnd: h.end
          }
        ),
        /* @__PURE__ */ d.jsxs("div", { className: "node-title", children: [
          /* @__PURE__ */ d.jsx(m, { size: 14 }),
          /* @__PURE__ */ d.jsx(
            "input",
            {
              className: "nodrag",
              "aria-label": "节点名称 " + r.title,
              value: r.title,
              maxLength: 80,
              onFocus: h.begin,
              onChange: (g) => h.edit(r.id, { title: g.target.value }, !1),
              onBlur: h.end
            }
          ),
          r.color !== "none" && /* @__PURE__ */ d.jsx("span", { className: "tag-dot " + r.color })
        ] }),
        /* @__PURE__ */ d.jsx(
          "div",
          {
            className: "node-content",
            onDoubleClick: () => {
              v ? (h.begin(), h.setEditing(r.id)) : o && h.preview(r);
            },
            children: v ? y ? /* @__PURE__ */ d.jsx(
              "textarea",
              {
                autoFocus: !0,
                className: "nodrag nowheel node-text",
                "aria-label": r.type === "text" ? "文本内容" : "便签内容",
                placeholder: r.type === "text" ? "输入文本" : "写下想法",
                value: r.text,
                maxLength: 12e3,
                onChange: (g) => h.edit(r.id, { text: g.target.value }, !1),
                onBlur: () => {
                  h.end(), h.setEditing(null);
                },
                onKeyDown: (g) => {
                  g.stopPropagation(), g.key === "Escape" && (g.preventDefault(), g.currentTarget.blur());
                }
              }
            ) : /* @__PURE__ */ d.jsx("div", { className: "text-display", children: r.text || /* @__PURE__ */ d.jsxs("span", { children: [
              "双击",
              r.type === "text" ? "输入文本" : "添加便签"
            ] }) }) : o ? r.type === "image" ? /* @__PURE__ */ d.jsx(
              "img",
              {
                src: Si(o),
                alt: r.title,
                draggable: !1,
                loading: "lazy"
              }
            ) : /* @__PURE__ */ d.jsxs("div", { className: "node-video", children: [
              /* @__PURE__ */ d.jsx(
                "video",
                {
                  src: Si(o) + "#t=0.05",
                  preload: "metadata",
                  muted: !0,
                  playsInline: !0
                }
              ),
              /* @__PURE__ */ d.jsx(
                "button",
                {
                  className: "node-play nodrag",
                  "aria-label": "播放 " + r.title,
                  onClick: () => h.preview(r),
                  children: /* @__PURE__ */ d.jsx(rN, { size: 24 })
                }
              )
            ] }) : /* @__PURE__ */ d.jsx("div", { className: "node-placeholder", children: f && ["queued", "running"].includes(f.status) ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
              /* @__PURE__ */ d.jsx(If, { size: 26, className: "spin" }),
              /* @__PURE__ */ d.jsx("span", { children: Hw(f) })
            ] }) : f?.status === "failed" ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
              /* @__PURE__ */ d.jsx(CE, { size: 26 }),
              /* @__PURE__ */ d.jsx("span", { children: "生成失败" })
            ] }) : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
              /* @__PURE__ */ d.jsx(m, { size: 28 }),
              s && r.type === "image" && /* @__PURE__ */ d.jsx(
                "button",
                {
                  className: "nodrag",
                  onClick: () => h.selectMedia(r.id),
                  children: "导入图片"
                }
              )
            ] }) })
          }
        ),
        ["image", "video"].includes(r.type) && /* @__PURE__ */ d.jsx(
          po,
          {
            type: "target",
            position: Ue.Left,
            className: "reference-handle",
            "aria-label": "连接到 " + r.title
          }
        ),
        ["text", "image"].includes(r.type) && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
          /* @__PURE__ */ d.jsx(
            po,
            {
              type: "source",
              position: Ue.Right,
              className: "reference-handle",
              "aria-label": "从 " + r.title + " 连接"
            }
          ),
          s && /* @__PURE__ */ d.jsx(
            "button",
            {
              className: "node-add nodrag",
              "aria-label": "从 " + r.title + " 新建连接",
              title: "新建连接",
              onClick: () => h.downstream(r.id),
              children: /* @__PURE__ */ d.jsx(La, { size: 14 })
            }
          )
        ] })
      ]
    }
  );
}), K4 = { content: Q4 };
function P4({
  project: n,
  studio: a
}) {
  const s = Qk(n, a.me.id), [r, o] = A.useState(a), [f, h] = A.useState([]), [m, v] = A.useState([]), [y, g] = A.useState([]), [p, S] = A.useState(null), [w, E] = A.useState(!1), [N, _] = A.useState(!1), [C, D] = A.useState(!0), [M, R] = A.useState(""), [Q, V] = A.useState([]), k = A.useRef(Promise.resolve()), H = A.useRef(null), [q, de] = A.useState(180), ee = A.useRef(null), [me, te] = A.useState(270), [O, Y] = A.useState(null), [j, B] = A.useState(null), [X, J] = A.useState(null), [I, ae] = A.useState(null), [he, Ee] = A.useState(null), [L, ce] = A.useState(null), [pe, Se] = A.useState(null), [le, Te] = A.useState(null), [Ce, we] = A.useState(null), [Ne, ze] = A.useState(!1), [Ve, $e] = A.useState(!1), [Me, Ge] = A.useState(null), [Re, _t] = A.useState({});
  A.useEffect(() => {
    let b = !0;
    return ln("/api/asset-packs").then((U) => {
      b && _t(Object.fromEntries(U.packs.map((G) => [G.id, G.media])));
    }).catch(() => {
    }), () => {
      b = !1;
    };
  }, [n.id]);
  const [it, At] = A.useState(1), [Mn, Et] = A.useState(!1), [sn, It] = A.useState(null), [bt, Nt] = A.useState(null), [St, ft] = A.useState([]), [Bt, gn] = A.useState(""), [$t, Qn] = A.useState(!1), [fn, Gt] = A.useState(!1), [yn, Wt] = A.useState(""), Li = A.useRef(null), [Zt, Tt] = A.useState(""), [vn, dn] = A.useState("all"), [Lt, zn] = A.useState(/* @__PURE__ */ new Set()), [Fe, qa] = A.useState({ w: innerWidth, h: innerHeight }), xn = id(), dt = xk(), en = G4(), hn = A.useRef(null), Mt = A.useRef(null), ri = A.useRef(null), rn = A.useRef(null), oe = A.useRef(
    null
  ), ke = A.useRef(!1), Ye = s.value.document.nodes.find((b) => b.id === m[0]), K = m.length === 1 && Ye ? Ye : null, at = K ? Oi(K, f) : null, Kn = at?.list.filter((b) => b.status === "done" && b.result) ?? [], Qt = s.value.document.shots ?? [], tn = Qt.flatMap((b) => {
    const U = s.value.document.nodes.find((_e) => _e.id === b);
    if (!U) return [];
    const { run: G, media: re } = Oi(U, f), F = G ?? (re ? r.jobs.find((_e) => _e.result === re) : void 0);
    return [{
      id: b,
      title: U.title,
      media: re,
      adopted: U.active_job,
      seconds: Math.max(yw(F) || U.params.seconds, f.find((_e) => _e.id === U.narration_job && _e.status === "done")?.actual?.duration || 0),
      status: G && Nf[G.status] || "待生成"
    }];
  }), dl = tn.reduce((b, U) => b + U.seconds, 0) > 300 ? "成片最多 5 分钟，请减少镜头或缩短旁白" : Qt.map((b, U) => {
    const G = s.value.document.nodes.find((_e) => _e.id === b);
    if (!Oi(G, f).media) return `镜头 ${U + 1} 的视频尚未就绪`;
    const re = f.find((_e) => _e.id === G.narration_pending);
    if (re && ["queued", "running"].includes(re.status)) return `镜头 ${U + 1} 的旁白仍在生成`;
    const F = f.find((_e) => _e.id === G.narration_job);
    return G.narration_text?.trim() && (!F?.result || F.status !== "done") ? `请先生成镜头 ${U + 1} 的旁白` : F && F.prompt.trim() !== (G.narration_text || "").trim() ? `镜头 ${U + 1} 的文稿已修改，请更新旁白` : "";
  }).find(Boolean) || "", Ln = s.value.document.nodes.find((b) => b.id === sn), Va = Ln ? Oi(Ln, f).list.filter((b) => b.status === "done" && b.result) : [], nn = (b) => (r.model_access || r.model_policy?.enabled)?.[b] === !0 && (b !== "gpt-image-2.6-sunburst" || r.images.configured) && (r.model_catalog?.[b]?.provider !== "flow" || !!r.flow?.configured), Ot = Object.keys(r.images.models || {}).some(nn), gi = Object.entries(K?.type === "image" ? r.images.models || {} : r.video_models || {}).filter(([b]) => nn(b)), Ya = K?.params.model || (K?.type === "image" ? "gpt-image-2.6-sunburst" : "MiniMax H3"), rt = gi.some(([b]) => b === Ya) ? Ya : sp(r.model_catalog, Ya, nn, K?.params) || gi[0]?.[0] || "", Ui = MN(Object.fromEntries(gi), r.model_catalog, nn, rt, K?.params), ht = r.model_catalog?.[rt]?.provider === "flow" ? r.model_catalog[rt] : null, kn = ht?.family ? AN(r.model_catalog, rt, nn) : null;
  A.useEffect(() => {
    if (!K || !["image", "video"].includes(K.type) || !rt) return;
    const b = rt.startsWith("muse-"), U = ht ? { model: rt, ratio: ht.ratio, seconds: ht.seconds, resolution: ht.resolution === "原生" ? "1K" : ht.resolution, fast_mode: !1, sampling_steps: 20, seed: null, flow_source_job: ht.mode === "extend" && K.params.flow_source_job || null } : { model: rt, flow_source_job: null, resolution: ["1K", "2K"].includes(K.params.resolution) ? K.params.resolution : "1K", ratio: b && !(K.type === "image" ? ["1:1", "16:9", "9:16", "4:3", "3:4"] : ["16:9", "9:16"]).includes(K.params.ratio) ? "16:9" : K.params.ratio, seconds: (b ? [5, 6, 8, 10] : [5, 10, 15]).includes(K.params.seconds) ? K.params.seconds : b ? 6 : 5 };
    if (Object.entries(U).every(([re, F]) => K.params[re] === F)) return;
    const G = K.id;
    s.change((re) => ({ ...re, document: { ...re.document, nodes: re.document.nodes.map((F) => F.id === G ? { ...F, params: { ...F.params, ...U } } : F) } }));
  }, [K?.id, K?.params.model, K?.params.ratio, K?.params.seconds, K?.params.resolution, rt]);
  const ea = rt.startsWith("muse-"), oi = Ot && nn(rt), qt = () => {
    Ee(null), Mt.current?.focus();
  };
  A.useEffect(() => {
    if (he !== "model") return;
    const b = requestAnimationFrame(() => {
      (ri.current?.querySelector('[aria-selected="true"]:not(:disabled)') || ri.current?.querySelector('[role="option"]:not(:disabled)'))?.focus();
    });
    return () => cancelAnimationFrame(b);
  }, [he, rt]);
  const bn = (b) => {
    if (he !== "model") {
      b.target === Mt.current && ["ArrowDown", "ArrowUp"].includes(b.key) && (b.preventDefault(), b.stopPropagation(), Ee("model"));
      return;
    }
    if (b.key === "Escape") {
      b.preventDefault(), b.stopPropagation(), qt();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(b.key)) {
      b.preventDefault(), b.stopPropagation();
      const U = [...ri.current?.querySelectorAll('[role="option"]:not(:disabled)') || []], G = U.indexOf(document.activeElement), re = b.key === "Home" ? 0 : b.key === "End" ? U.length - 1 : (G + (b.key === "ArrowDown" ? 1 : -1) + U.length) % U.length;
      U[re]?.focus();
    }
  }, Pe = A.useCallback((b) => R(b), []);
  A.useEffect(() => {
    if (!M) return;
    const b = setTimeout(() => R(""), 4500);
    return () => clearTimeout(b);
  }, [M]);
  const ga = A.useCallback(async () => {
    const [b, U] = await Promise.all([ln(`/api/canvases/${n.id}/runs`), ln("/api/state")]);
    return h(b.runs), o(U), b.runs;
  }, [n.id]);
  A.useEffect(() => {
    let b = !0;
    const U = async () => {
      try {
        const [re, F] = await Promise.all([
          ln(`/api/canvases/${n.id}/runs`),
          ln("/api/state")
        ]);
        b && (h(re.runs), o(F));
      } catch (re) {
        b && re instanceof Wr && [401, 403, 404].includes(re.status) && location.assign("/studio");
      }
    };
    U();
    const G = setInterval(() => {
      document.hidden || U();
    }, 5e3);
    return () => {
      b = !1, clearInterval(G);
    };
  }, [n.id]), A.useEffect(() => {
    const b = () => qa({ w: innerWidth, h: innerHeight });
    return window.addEventListener("resize", b), () => window.removeEventListener("resize", b);
  }, []), A.useEffect(() => {
    if (innerWidth <= 760) {
      const b = s.ref.current.document.nodes.find(
        (U) => U.id === m[0]
      );
      if (b) {
        const U = Math.max(0.25, Math.min(1, (innerWidth - 112) / b.width));
        xn.setViewport({
          zoom: U,
          x: innerWidth * 0.55 - (b.x + b.width / 2) * U,
          y: innerHeight * 0.3 - (b.y + b.height / 2) * U
        });
      }
    }
  }, [Fe.w]);
  const zt = A.useCallback(
    (b, U, G = !0) => s.change(
      (re) => ({
        ...re,
        document: {
          ...re.document,
          nodes: re.document.nodes.map(
            (F) => F.id === b ? { ...F, ...U } : F
          )
        }
      }),
      G
    ),
    [s.change]
  );
  A.useEffect(() => {
    if (s.status === "conflict") return;
    const b = /* @__PURE__ */ new Map();
    for (const U of s.value.document.nodes) {
      const G = f.find((re) => re.id === U.narration_pending);
      G?.status === "done" && G.result && G.prompt.trim() === (U.narration_text || "").trim() && (G.inputs?.instruction || "").trim() === (U.narration_instruction || "").trim() && b.set(U.id, G.id);
    }
    b.size && s.change((U) => ({ ...U, document: { ...U.document, nodes: U.document.nodes.map((G) => b.has(G.id) ? { ...G, narration_job: b.get(G.id), narration_pending: null } : G) } }));
  }, [f, s.value.document.nodes, s.status]);
  const ta = A.useMemo(
    () => ({
      edit: zt,
      begin: s.begin,
      end: s.end,
      downstream: J,
      selectMedia: (b) => {
        B(b), dn("image"), Y("assets");
      },
      preview: (b) => {
        const { media: U, run: G } = Oi(b, f);
        U && (gn(""), Te({ node: b, media: U, run: G }));
      },
      zoom: dt.zoom,
      editing: p,
      setEditing: S
    }),
    [zt, s.begin, s.end, dt.zoom, p, f]
  ), na = A.useMemo(
    () => s.value.document.nodes.map((b) => ({
      id: b.id,
      type: "content",
      position: { x: b.x, y: b.y },
      data: { item: b, ...Oi(b, f) },
      width: b.width,
      height: b.height,
      style: { width: b.width, height: b.height },
      selected: m.includes(b.id),
      ariaLabel: bc[b.type] + "节点 " + b.title
    })),
    [s.value.document.nodes, f, m]
  ), Bi = A.useMemo(
    () => s.value.document.edges.map((b) => ({
      ...b,
      type: "default",
      selected: y.includes(b.id),
      hidden: !C,
      style: { stroke: "var(--cv-edge)", strokeWidth: 1.4 },
      interactionWidth: 20,
      ariaLabel: "参考连线"
    })),
    [s.value.document.edges, C, y]
  ), ia = A.useCallback(
    (b) => {
      const U = b.filter((F) => F.type === "select");
      U.length && v((F) => {
        const _e = new Set(F);
        for (const Be of U)
          Be.type === "select" && (Be.selected ? _e.add(Be.id) : _e.delete(Be.id));
        return [..._e];
      });
      const G = b.filter(
        (F) => F.type === "position" || F.type === "dimensions" && F.resizing
      ), re = G.some((F) => F.type === "position" && F.dragging === !1) && !ke.current;
      re && s.begin(), G.length && s.change(
        (F) => ({
          ...F,
          document: {
            ...F.document,
            nodes: F.document.nodes.map((_e) => {
              let Be = _e;
              for (const De of G)
                !("id" in De) || De.id !== _e.id || (De.type === "position" && De.position && (Be = { ...Be, x: De.position.x, y: De.position.y }), De.type === "dimensions" && De.dimensions && (Be = {
                  ...Be,
                  width: De.dimensions.width,
                  height: De.dimensions.height
                }));
              return Be;
            })
          }
        }),
        !1
      ), re && s.end();
    },
    [s.change]
  ), aa = A.useCallback((b) => {
    g((U) => {
      const G = new Set(U);
      for (const re of b)
        re.type === "select" && (re.selected ? G.add(re.id) : G.delete(re.id));
      return [...G];
    });
  }, []), _i = A.useCallback(
    (b) => {
      const U = pf(
        s.ref.current.document,
        b.source,
        b.target
      );
      if (U) {
        Pe(U);
        return;
      }
      s.change((G) => ({
        ...G,
        document: {
          ...G.document,
          edges: [
            ...G.document.edges,
            {
              id: crypto.randomUUID(),
              source: b.source,
              target: b.target
            }
          ]
        }
      })), v([b.target]);
    },
    [s.change, Pe]
  ), Ei = (b, U = !1) => {
    if (Fe.w <= 760) return;
    const G = b.y * dt.zoom + dt.y;
    if (!U && G >= 150 && G + b.height * dt.zoom + 20 + q <= Fe.h - 80) return;
    const re = Math.max(0.15, Math.min(dt.zoom, 1, (Fe.w - 112) / b.width, Math.max(32, Fe.h - 250 - q) / b.height)), F = U ? Fe.w * 0.55 : (b.x + b.width / 2) * dt.zoom + dt.x, _e = Math.max(76 + b.width * re / 2, Math.min(F, Fe.w - 24 - b.width * re / 2)), Be = Math.max(150, Math.min(G, Fe.h - 100 - q - b.height * re));
    xn.setViewport({ zoom: re, x: _e - (b.x + b.width / 2) * re, y: Be - b.y * re }, { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180 });
  };
  A.useEffect(() => {
    if (K?.type !== "text" || p || !H.current) return;
    const b = H.current, U = () => de(Math.ceil(b.getBoundingClientRect().height));
    U();
    const G = new ResizeObserver(U);
    return G.observe(b), () => G.disconnect();
  }, [K?.id, p]), A.useEffect(() => {
    K?.type === "text" && !p && Ei(K);
  }, [K?.id, p, q, Fe.w, Fe.h]), A.useEffect(() => {
    const b = ee.current;
    if (!b) return;
    const U = () => te(Math.ceil(b.getBoundingClientRect().height));
    U();
    const G = new ResizeObserver(U);
    return G.observe(b), () => G.disconnect();
  }, [K?.id, p, K?.type]);
  const $i = (b) => {
    const U = Math.max(
      0.25,
      Math.min(
        dt.zoom,
        1,
        (Fe.w - 112) / b.width,
        (Fe.h - 350) / b.height
      )
    );
    xn.setViewport(
      {
        zoom: U,
        x: Fe.w * 0.55 - (b.x + b.width / 2) * U,
        y: Math.max(200, Fe.h * 0.32) - (b.y + b.height / 2) * U
      },
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200
      }
    );
  }, jn = (b) => {
    v([b]), g([]), S(null), Ee(null), ae(null);
  }, yt = (b) => {
    const U = b.length === 1 ? s.ref.current.document.nodes.find((G) => G.id === b[0]) : null;
    if (U?.type === "text" && Fe.w > 760) {
      Ei(U, !0);
      return;
    }
    xn.fitView({
      nodes: b.map((G) => ({ id: G })),
      padding: 0.5,
      maxZoom: 1,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220
    });
  }, ci = (b, U, G) => {
    if (s.ref.current.document.nodes.length >= 200) {
      Pe("每张画布最多 200 个节点");
      return;
    }
    const re = U ? s.ref.current.document.nodes.find((tt) => tt.id === U) : null, F = G || xn.screenToFlowPosition({
      x: Fe.w * 0.48,
      y: Fe.h * 0.38
    });
    let _e = re ? re.x + re.width + 180 : F.x - 160, Be = re ? re.y : F.y - 120;
    ({ x: _e, y: Be } = gc(s.ref.current.document.nodes, _e, Be, 320, 240));
    const De = us(
      b,
      _e,
      Be,
      s.ref.current.document.nodes.filter((tt) => tt.type === b).length + 1
    );
    return (b === "image" || b === "video") && (De.params.model = Object.keys(b === "image" ? r.images.models || {} : r.video_models || {}).find(nn) || "", De.params.model === "muse-video" && (De.params.seconds = 6)), s.change((tt) => ({
      ...tt,
      document: {
        ...tt.document,
        nodes: [...tt.document.nodes, De],
        edges: U ? [
          ...tt.document.edges,
          { id: crypto.randomUUID(), source: U, target: De.id }
        ] : tt.document.edges
      }
    })), jn(De.id), J(null), ae(null), requestAnimationFrame(() => $i(De)), De;
  }, la = () => {
    const b = new Set(m);
    s.change((U) => ({
      ...U,
      document: {
        ...U.document,
        nodes: U.document.nodes.filter((G) => !b.has(G.id)),
        shots: U.document.shots?.filter((G) => !b.has(G)),
        edges: U.document.edges.filter(
          (G) => !b.has(G.source) && !b.has(G.target) && !y.includes(G.id)
        )
      }
    })), v([]), g([]), Ee(null), ae(null);
  }, Ia = (b) => s.change((U) => ({ ...U, document: { ...U.document, shots: b(U.document.shots ?? []) } })), ui = (b) => {
    Ia((U) => U.includes(b.id) ? U : [...U, b.id]), Pe("已加入镜头列表");
  }, Ni = (b, U) => Ia((G) => {
    const re = G.indexOf(b), F = re + U;
    if (re < 0 || F < 0 || F >= G.length) return G;
    const _e = [...G];
    return [_e[re], _e[F]] = [_e[F], _e[re]], _e;
  }), Xa = async () => {
    const b = await s.flush(), U = await ln(
      `/api/canvases/${n.id}/shots/download`,
      { expected_revision: b }
    ), G = document.createElement("a");
    G.href = U.url, G.download = U.filename, G.click();
  }, ya = (b) => {
    va(""), ft(s.ref.current.document.edges.filter(
      (U) => U.source === b && Qt.includes(U.target)
    ).map((U) => U.target)), Nt(b);
  }, [Ol, Dl] = A.useState(!1), [Ke, va] = A.useState(""), Un = () => {
    if (!bt) return;
    const b = s.ref.current.document, U = new Set(St), G = new Set(b.shots), re = b.edges.filter((F) => F.source !== bt || !G.has(F.target) || U.has(F.target));
    for (const F of U) {
      if (re.some((Be) => Be.source === bt && Be.target === F)) continue;
      const _e = pf({ ...b, edges: re }, bt, F);
      if (_e || re.length >= 600) {
        va(_e || "每张画布最多 600 条参考连线");
        return;
      }
      re.push({ id: crypto.randomUUID(), source: bt, target: F });
    }
    s.change((F) => ({ ...F, document: { ...F.document, edges: re } })), Nt(null), Pe("已更新镜头的参考图");
  }, hl = async ({ node: b, media: U, run: G }, re) => {
    if (!Li.current || fn) return;
    const F = () => {
      const De = s.ref.current.document;
      if (De.nodes.length + (re ? 2 : 1) > 200 || re && De.edges.length >= 600)
        throw new Error("画布节点或连线已达上限，请先整理画布");
      if (!De.nodes.some((tt) => tt.id === b.id))
        throw new Error("来源节点已移除");
      return De;
    }, _e = Li.current, Be = _e.currentTime.toFixed(2);
    Gt(!0), gn("");
    try {
      F();
      const De = await V4(_e), tt = await vx(De, () => {
      }, { media: U, seconds: Number(Be) });
      o((Ai) => ({ ...Ai, assets: [{ ...tt, owner: Ai.me.id }, ...Ai.assets] }));
      const On = F(), Ea = 320, ot = Math.max(160, Math.min(480, Ea * tt.h / tt.w)), Fn = G ? "#" + G.id : U.slice(0, 8), Ci = {
        ...us("image", b.x + b.width + 180, b.y, 1),
        ...gc(On.nodes, b.x + b.width + 180, b.y, Ea, ot),
        title: `${b.title.slice(0, 45)} · ${Fn} · ${Be} 秒取帧`,
        media_id: tt.id,
        use_media: !0,
        height: ot
      }, Vn = [...On.nodes, Ci], Vi = [...On.edges], Za = [...On.shots ?? []];
      let hi = Ci;
      if (re) {
        const Ai = G?.ratio || b.params.ratio, Ss = gc(Vn, Ci.x + Ci.width + 180, Ci.y, 320, 240);
        hi = us("video", Ss.x, Ss.y, 1), hi.title = "下一镜头", hi.params.model = "MiniMax H3", hi.params.ratio = r.ratios.includes(Ai) ? Ai : "16:9", Vn.push(hi), Vi.push({ id: crypto.randomUUID(), source: Ci.id, target: hi.id }), Za.includes(b.id) || Za.push(b.id), Za.splice(Za.indexOf(b.id) + 1, 0, hi.id);
      }
      s.change((Ai) => ({
        ...Ai,
        document: { ...Ai.document, nodes: Vn, edges: Vi, shots: re ? Za : On.shots }
      })), Te(null), jn(hi.id), requestAnimationFrame(() => $i(hi)), Pe(re ? "已将当前画面设为新镜头首帧" : "已提取当前帧到画布与素材库");
    } catch (De) {
      gn(De.message);
    } finally {
      Gt(!1);
    }
  }, Pn = () => {
    const b = new Set(m);
    oe.current = {
      nodes: structuredClone(
        s.ref.current.document.nodes.filter((U) => b.has(U.id))
      ),
      edges: structuredClone(
        s.ref.current.document.edges.filter(
          (U) => b.has(U.source) && b.has(U.target)
        )
      )
    }, Pe(`已复制 ${b.size} 个节点`);
  }, on = (b = !1) => {
    const U = b ? {
      nodes: s.ref.current.document.nodes.filter(
        (F) => m.includes(F.id)
      ),
      edges: s.ref.current.document.edges.filter(
        (F) => m.includes(F.source) && m.includes(F.target)
      )
    } : oe.current;
    if (!U?.nodes.length) return;
    if (s.ref.current.document.nodes.length + U.nodes.length > 200) {
      Pe("每张画布最多 200 个节点");
      return;
    }
    const G = new Map(
      U.nodes.map((F) => [F.id, crypto.randomUUID()])
    ), re = U.nodes.map((F) => ({
      ...structuredClone(F),
      id: G.get(F.id),
      x: F.x + 56,
      y: F.y + 56,
      media_id: Oi(F, f).media,
      active_job: null,
      use_media: !0
    }));
    s.change((F) => ({
      ...F,
      document: {
        ...F.document,
        nodes: [...F.document.nodes, ...re],
        edges: [
          ...F.document.edges,
          ...U.edges.map((_e) => ({
            id: crypto.randomUUID(),
            source: G.get(_e.source),
            target: G.get(_e.target)
          }))
        ]
      }
    })), v(re.map((F) => F.id)), ae(null);
  }, vs = () => {
    const b = s.ref.current.document.nodes.filter(
      (De) => m.includes(De.id)
    );
    if (b.length < 2) return;
    const U = Math.min(...b.map((De) => De.x)), G = Math.min(...b.map((De) => De.y)), re = Math.ceil(Math.sqrt(b.length)), F = Math.max(...b.map((De) => De.width)) + 60, _e = Math.max(...b.map((De) => De.height)) + 80, Be = new Map(
      b.map((De, tt) => [
        De.id,
        { x: U + tt % re * F, y: G + Math.floor(tt / re) * _e }
      ])
    );
    s.change((De) => ({
      ...De,
      document: {
        ...De.document,
        nodes: De.document.nodes.map((tt) => ({ ...tt, ...Be.get(tt.id) }))
      }
    }));
  }, sa = async () => {
    const b = s.ref.current.document.nodes.filter(
      (re) => m.includes(re.id)
    ), U = b.map((re) => Oi(re, f).media).filter(Boolean), G = b.filter((re) => ["text", "sticky"].includes(re.type));
    try {
      if (U.length === 1) {
        const re = document.createElement("a");
        re.href = Si(U[0]) + "?download=true", re.download = "", re.click();
      } else if (U.length) {
        const re = U.map((Be) => {
          const De = r.jobs.find((tt) => tt.result === Be);
          return De ? "job:" + De.id : "asset:" + Be;
        }), F = await ln("/api/assets/batch-download", { keys: re }), _e = document.createElement("a");
        _e.href = F.url, _e.download = F.filename, _e.click();
      }
      if (G.length) {
        const re = URL.createObjectURL(
          new Blob([G.map((_e) => `${_e.title}
${_e.text}`).join(`

`)], {
            type: "text/plain;charset=utf-8"
          })
        ), F = document.createElement("a");
        F.href = re, F.download = n.title + ".txt", F.click(), setTimeout(() => URL.revokeObjectURL(re), 1e3);
      }
    } catch (re) {
      Pe(re.message);
    }
  };
  A.useEffect(() => {
    const b = (U) => {
      if (U.target.closest(
        'input,textarea,[contenteditable="true"],dialog'
      ))
        return;
      const G = U.metaKey || U.ctrlKey;
      if (U.key === "Escape") {
        Ee(null), ae(null), J(null), Y(null), v([]);
        return;
      }
      G && U.key.toLowerCase() === "z" ? (U.preventDefault(), s.travel(U.shiftKey)) : G && U.key.toLowerCase() === "c" ? (U.preventDefault(), Pn()) : G && U.key.toLowerCase() === "v" ? (U.preventDefault(), on()) : G && U.key.toLowerCase() === "d" ? (U.preventDefault(), on(!0)) : G && U.key.toLowerCase() === "a" ? (U.preventDefault(), v(s.ref.current.document.nodes.map((re) => re.id))) : U.key === "Backspace" || U.key === "Delete" ? (U.preventDefault(), la()) : U.shiftKey && U.key === "!" ? (U.preventDefault(), yt(s.ref.current.document.nodes.map((re) => re.id))) : U.shiftKey && U.key === "@" ? (U.preventDefault(), yt(m)) : G && U.key === "1" ? (U.preventDefault(), xn.zoomTo(1)) : G && ["+", "="].includes(U.key) ? (U.preventDefault(), xn.zoomIn()) : G && U.key === "-" ? (U.preventDefault(), xn.zoomOut()) : U.key.toLowerCase() === "v" ? E(!1) : U.key.toLowerCase() === "h" && E(!0);
    };
    return window.addEventListener("keydown", b), () => window.removeEventListener("keydown", b);
  }, [m, y, f, r.jobs]), A.useEffect(() => {
    const b = (U) => {
      U.target.closest(".cv-menu,.menu-trigger") || (Ee(null), ae(null), J(null));
    };
    return document.addEventListener("pointerdown", b), () => document.removeEventListener("pointerdown", b);
  }, []);
  const xa = A.useMemo(() => {
    const b = r.jobs.filter((G) => G.status === "done" && G.result && ["image", "video"].includes(G.kind)).map((G) => ({
      id: G.result,
      kind: G.kind,
      w: G.width,
      h: G.height,
      title: (G.kind === "image" ? "图片" : "视频") + " #" + G.id,
      description: G.prompt
    })), U = new Set(b.map((G) => G.id));
    return [
      ...b,
      ...r.assets.filter((G) => !U.has(G.id) && (!G.kind || G.kind === "ref")).map((G) => ({
        id: G.id,
        kind: "image",
        w: G.w,
        h: G.h,
        title: "上传图片",
        description: G.id
      }))
    ];
  }, [r]), xs = () => {
    const b = xa.filter((re) => Lt.has(re.id));
    if (!b.length) return;
    if (s.ref.current.document.nodes.length + b.length > 200) {
      Pe("每张画布最多 200 个节点");
      return;
    }
    const U = xn.screenToFlowPosition({
      x: Fe.w * 0.4,
      y: Fe.h * 0.35
    }), G = j ? s.ref.current.document.nodes.find((re) => re.id === j) : null;
    if (G) {
      const re = b[0];
      zt(G.id, {
        media_id: re.id,
        active_job: null,
        use_media: !0,
        width: 360,
        height: Math.max(160, Math.min(480, 360 * re.h / re.w))
      }), jn(G.id);
    } else {
      const re = [...s.ref.current.document.nodes], F = b.map((_e, Be) => {
        const De = Math.max(160, Math.min(480, 360 * _e.h / _e.w)), tt = gc(re, U.x, U.y, 360, De), On = {
          ...us(
            _e.kind,
            tt.x,
            tt.y,
            s.ref.current.document.nodes.filter((Ea) => Ea.type === _e.kind).length + Be + 1
          ),
          title: _e.title,
          media_id: _e.id,
          width: 360,
          height: De
        };
        return re.push(On), On;
      });
      s.change((_e) => ({
        ..._e,
        document: { ..._e.document, nodes: [..._e.document.nodes, ...F] }
      })), v(F.map((_e) => _e.id)), requestAnimationFrame(() => $i(F[0]));
    }
    Y(null), B(null), zn(/* @__PURE__ */ new Set());
  }, rr = async (b) => {
    if (pe === null) {
      Se(0);
      try {
        for (const U of b) {
          if (!I4(U)) {
            Pe("不支持该图片格式");
            continue;
          }
          if (U.size > 16 * 1024 * 1024) {
            Pe("每张图片不能超过 16 MB");
            continue;
          }
          if (s.ref.current.document.nodes.length >= 200)
            throw new Error("每张画布最多 200 个节点");
          const G = await vx(U, Se);
          G.first_frame ? Pe("动态图或多页图片已按首帧导入") : G.resized && Pe(`图片已适配为 ${G.w} × ${G.h}`), o((F) => ({
            ...F,
            assets: [{ ...G, owner: F.me.id }, ...F.assets]
          }));
          const re = rn.current;
          if (re)
            zt(re, {
              media_id: G.id,
              active_job: null,
              use_media: !0,
              width: 360,
              height: Math.max(160, Math.min(480, 360 * G.h / G.w))
            });
          else {
            const F = ci("image");
            F && zt(F.id, {
              title: U.name.slice(0, 80),
              media_id: G.id,
              width: 360,
              height: Math.max(160, Math.min(480, 360 * G.h / G.w))
            });
          }
          rn.current = null;
        }
      } catch (U) {
        Pe(U.message);
      } finally {
        Se(null), hn.current && (hn.current.value = "");
      }
    }
  }, Bn = async () => {
    if (Et(!1), !K || L) return;
    const b = K.id;
    K.active_job || zt(b, { use_media: !1 }), ce(b);
    try {
      const U = await s.flush(), G = `fm-canvas-candidates-${r.me.id}-${n.id}-${b}`;
      let re;
      try {
        re = JSON.parse(localStorage.getItem(G) || "null");
      } catch {
      }
      re || (re = { uid: crypto.randomUUID(), expected_revision: U, price_revision: r.pricing.revision, count: it }, localStorage.setItem(G, JSON.stringify(re)));
      try {
        await ln(`/api/canvases/${n.id}/nodes/${b}/candidates`, re), localStorage.removeItem(G);
      } catch (F) {
        throw F instanceof Wr && F.status < 500 && localStorage.removeItem(G), F;
      }
      await ga(), Pe("已加入生成队列");
    } catch (U) {
      Pe(U.message);
    } finally {
      ce(null);
    }
  }, qi = K ? s.value.document.edges.filter((b) => b.target === K.id).map((b) => ({
    edge: b,
    node: s.value.document.nodes.find((U) => U.id === b.source)
  })) : [], ba = qi.find(
    ({ node: b }) => b.type === "text" ? !b.text.trim() : !Oi(b, f).media
  ), Sa = qi.filter(({ node: b }) => b.type === "image").map(({ node: b }) => Oi(b, f).media), Rn = K?.type === "video" && rt === "MiniMax H3", Jn = K?.params.h3 || { mode: "reference", video_audio: [] }, Ti = Rn && Jn.mode === "frames", xe = [.../* @__PURE__ */ new Set([...Sa, ...K?.params.h3_refs || []])].filter((b) => !!b), z = [.../* @__PURE__ */ new Set([...Ti ? [Jn.first_frame, Jn.last_frame].filter(Boolean) : Rn ? xe : Sa, ...(K?.asset_packs || []).flatMap((b) => Re[b.id] || [])])], P = async (b, U) => {
    const G = await ln("/api/state"), re = s.ref.current.document, F = re.nodes.find((ot) => ot.id === Me);
    if (!F) throw new Error("节点已移除，请重新选择");
    if (F.type === "video" && F.params.model === "MiniMax H3" && F.params.h3?.mode === "frames")
      throw new Error("首尾帧模式请使用首帧和尾帧选择器");
    const Be = [...re.edges.filter((ot) => ot.target === F.id).map((ot) => re.nodes.find((Fn) => Fn.id === ot.source)).filter((ot) => !!(ot && ot.type === "image")).map((ot) => Oi(ot, f).media).filter((ot) => !!ot), ...F.params.h3_refs || []], De = U ? F.asset_packs || [] : (F.asset_packs || []).filter((ot) => ot.id !== b.id), tt = [.../* @__PURE__ */ new Set([...Be, ...De.flatMap((ot) => Re[ot.id] || [])])], On = [...new Set(U || b.media)];
    if (On.some((ot) => !G.assets.some((Fn) => Fn.id === ot && (!Fn.kind || Fn.kind === "ref")))) throw new Error("图片已移除或不在当前空间，请重新选择");
    const Ea = [.../* @__PURE__ */ new Set([...tt, ...On])];
    if (Ea.filter((ot) => al(G.assets.find((Fn) => Fn.id === ot)) === "Picture").length > 9) throw new Error("最多选择 9 张参考图片，请先移除部分图片");
    if (Ea.length > 12) throw new Error("参考素材已达上限，请先移除部分素材");
    if (o((ot) => ({ ...ot, assets: G.assets })), U) {
      const ot = On.filter((Vn) => !tt.includes(Vn));
      if (re.nodes.length + ot.length > 200 || re.edges.length + ot.length > 600) throw new Error("画布容量不足，请先整理节点");
      const Fn = [...re.nodes], Ci = ot.map((Vn, Vi) => {
        const Za = G.assets.find((rd) => rd.id === Vn), hi = Math.max(160, Math.min(480, 240 * Za.h / Za.w)), Ai = gc(Fn, F.x - 360, F.y, 240, hi), Ss = { ...us("image", Ai.x, Ai.y, Vi + 1), title: b.name + " · " + (b.media.indexOf(Vn) + 1), media_id: Vn, use_media: !0, width: 240, height: hi };
        return Fn.push(Ss), Ss;
      });
      Ci.length && s.change((Vn) => ({ ...Vn, document: { ...Vn.document, nodes: [...Vn.document.nodes, ...Ci], edges: [...Vn.document.edges, ...Ci.map((Vi) => ({ id: crypto.randomUUID(), source: Vi.id, target: F.id }))] } }));
    } else
      _t((ot) => ({ ...ot, [b.id]: b.media })), zt(F.id, { asset_packs: [...De, { id: b.id, revision: b.revision }] });
    Ge(null);
  }, be = K?.type === "video" && rt === "MiniMax H3" && !K.params.h3 && z.length === 1 ? z[0] : null, ye = at?.run?.inputs, He = [...qi.filter(({ node: b }) => b.type === "text").map(({ node: b }) => b.text.trim()), ...K?.prompt.trim() ? [K.prompt.trim()] : []].join(`

`), qe = at?.run?.status === "done" && ye && (ye.prompt !== He || JSON.stringify(ye.refs || []) !== JSON.stringify(Sa) || JSON.stringify(ye.asset_packs || []) !== JSON.stringify(K?.asset_packs || []) || JSON.stringify(ye.params) !== JSON.stringify(K?.params)), Ze = K ? r.sizes[K.params.ratio] : null, vt = K?.params.quality === 768 ? 2 : 0, fi = Ze ? `${Ze[vt]} / ${Ze[vt + 1]}` : "16 / 9", mn = !!(K?.prompt.trim() || qi.some(({ node: b }) => b.type === "text" && b.text.trim())), Kt = at?.list.filter((b) => ["queued", "running"].includes(b.status)) || [], yi = Kt.length > 0, Sn = at?.latest?.batch, Hl = Sn?.count === 2 ? at?.list.filter((b) => b.batch?.uid === Sn.uid) || [] : Kt, Gc = ht || rt === "muse-image" ? "native" : rt === "muse-video" ? String(K?.params.seconds) : K?.type === "image" ? `${K.params.resolution}|${K.params.image_quality}` : `${K?.params.quality}|${K?.params.seconds}`, wa = r.pricing?.items.find((b) => b.key === rt + "|" + Gc)?.amount, di = wa == null ? null : wa * it, bs = di != null && r.credits.available >= di, ml = ht ? z.length < (ht.min_refs || 0) ? `请添加至少 ${ht.min_refs} 张参考图片` : z.length > (ht.max_refs || 0) ? ht.max_refs ? `这个模型最多接收 ${ht.max_refs} 张参考图片` : "这个模型不接收参考图片" : ht.mode === "extend" && !K?.params.flow_source_job ? "请选择来源视频" : "" : "", Ga = r.jobs.filter((b) => b.kind === "video" && b.status === "done" && b.actual?.flow_media_id && b.ratio === ht?.ratio), or = K && ["image", "video"].includes(K.type) && mn && !ba && !ml && !yi && !L && !Ol && s.status !== "conflict" && (K.type !== "image" || oi) && nn(rt) && bs, Ll = async (b) => {
    try {
      await s.flush(), location.assign(sl(b));
    } catch (U) {
      Pe(U.message);
    }
  }, wn = K ? {
    x: K.x * dt.zoom + dt.x,
    y: K.y * dt.zoom + dt.y,
    w: K.width * dt.zoom,
    h: K.height * dt.zoom
  } : null, cr = K && ["image", "video"].includes(K.type) && !p, ur = K?.type === "text" ? q : me, xo = !!(wn && wn.y < 150), $n = 24 * dt.zoom * 2 ** Math.max(0, Math.ceil(Math.log2(16 / (24 * dt.zoom)))), _a = wn ? {
    left: Math.max(
      76,
      Math.min(wn.x + wn.w / 2 - 260, Fe.w - 544)
    ),
    top: Math.max(
      100,
      Math.min(
        wn.y + wn.h + (xo ? 70 : 20),
        Fe.h - ur - (K?.type === "text" ? 80 : 20)
      )
    )
  } : {}, fr = wn ? {
    left: Math.max(
      76,
      Math.min(wn.x + wn.w / 2 - 170, Fe.w - 370)
    ),
    top: xo ? Math.max(68, wn.y + wn.h + 14) : wn.y - 82
  } : {}, qn = (b, U) => {
    if (!K) return;
    let G = { ...K.params, ...b };
    const re = r.model_catalog[G.model];
    if (re?.family) {
      const F = sp(r.model_catalog, G.model, nn, { ratio: G.ratio, seconds: G.seconds, mode: U || re.mode });
      if (!F) return;
      const _e = r.model_catalog[F];
      G = { ...G, model: F, ratio: _e.ratio, seconds: _e.seconds, flow_source_job: _e.mode === "extend" && _e.ratio === K.params.ratio && G.flow_source_job || null };
    }
    zt(K.id, { params: G });
  }, sd = (b, U) => {
    if (!K) return;
    const G = new Set(U);
    s.change((re) => ({ ...re, document: { ...re.document, edges: re.document.edges.filter((F) => F.target !== K.id || re.document.nodes.find((_e) => _e.id === F.source)?.type !== "image" || G.has(Oi(re.document.nodes.find((_e) => _e.id === F.source), f).media || "")), nodes: re.document.nodes.map((F) => F.id === K.id ? { ...F, prompt: ux(F.prompt, xe, U, r.assets, b.mode === "frames" ? b : void 0), params: { ...F.params, h3: b, h3_refs: U.filter((_e) => !Sa.includes(_e)) } } : F) } }));
  }, bo = (b) => {
    if (!K) return;
    if (b === "frames" && K.asset_packs?.length) {
      Pe("请先将素材包图片放入画布并取消素材包，再选择首尾帧");
      return;
    }
    if (b === "reference") {
      qn({ h3: { mode: b, video_audio: [] }, h3_refs: [...new Set([...K.params.h3_refs || [], Jn.first_frame, Jn.last_frame].filter((Be) => !!Be))] }), Ee(null);
      return;
    }
    const U = xe.filter((Be) => al(r.assets.find((De) => De.id === Be)) === "Picture");
    let G = U[1] || null;
    const re = r.assets.find((Be) => Be.id === U[0]), F = r.assets.find((Be) => Be.id === G);
    re && F && Math.abs(Math.log(re.w / re.h / (F.w / F.h))) > 0.035 && (G = null);
    const _e = { mode: b, first_frame: U[0] || null, last_frame: G, video_audio: [] };
    zt(K.id, { prompt: ux(K.prompt, xe, xe, r.assets, _e), params: { ...K.params, h3: _e } }), Ee(null);
  };
  A.useEffect(() => {
    Rn && K && !K.params.h3 && qn({ h3: xe.length === 1 ? { mode: "frames", first_frame: xe[0], last_frame: null, video_audio: [] } : { mode: "reference", video_audio: [] } });
  }, [K?.id, Rn]);
  const dr = K ? s.value.document.nodes.filter(
    (b) => b.id !== K.id && ["image", "text"].includes(b.type) && !s.value.document.edges.some(
      (U) => U.source === b.id && U.target === K.id
    )
  ) : [];
  return /* @__PURE__ */ d.jsxs(
    "div",
    {
      className: "canvas-workspace",
      tabIndex: -1,
      onKeyDown: (b) => {
        const U = b.target.closest(".cv-menu");
        if (U) {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(b.key)) {
            b.preventDefault(), b.stopPropagation();
            const G = Array.from(
              U.querySelectorAll("button:not(:disabled)")
            ), re = G.indexOf(
              document.activeElement
            ), F = b.key === "Home" ? 0 : b.key === "End" ? G.length - 1 : (re + (b.key === "ArrowDown" ? 1 : -1) + G.length) % G.length;
            G[F]?.focus();
          }
          b.key === "Escape" && (b.preventDefault(), b.stopPropagation(), Ee(null), ae(null), J(null));
        }
      },
      children: [
        /* @__PURE__ */ d.jsx(Lw.Provider, { value: ta, children: /* @__PURE__ */ d.jsx(
          yk,
          {
            nodes: na,
            edges: Bi,
            nodeTypes: K4,
            onNodesChange: ia,
            onEdgesChange: aa,
            onConnect: _i,
            isValidConnection: (b) => !pf(s.ref.current.document, b.source, b.target),
            onNodeDragStart: () => {
              ke.current = !0, s.begin();
            },
            onNodeDragStop: () => {
              ke.current = !1, s.end();
            },
            onSelectionDragStart: () => {
              ke.current = !0, s.begin();
            },
            onSelectionDragStop: () => {
              ke.current = !1, s.end();
            },
            onPaneClick: () => {
              v([]), g([]), S(null), Ee(null);
            },
            onNodeContextMenu: (b, U) => {
              b.preventDefault(), v([U.id]), ae({ x: b.clientX, y: b.clientY, node: U.id });
            },
            onPaneContextMenu: (b) => {
              b.preventDefault(), ae({ x: b.clientX, y: b.clientY });
            },
            onMoveEnd: (b, U) => {
              try {
                localStorage.setItem(
                  "fm-canvas-view-" + n.id,
                  JSON.stringify(U)
                );
              } catch {
              }
            },
            defaultViewport: (() => {
              try {
                return JSON.parse(
                  localStorage.getItem("fm-canvas-view-" + n.id) || "null"
                ) || { x: 200, y: 140, zoom: 1 };
              } catch {
                return { x: 200, y: 140, zoom: 1 };
              }
            })(),
            onDrop: (b) => {
              b.preventDefault(), rr([...b.dataTransfer.files]);
            },
            onDragOver: (b) => {
              b.preventDefault(), b.dataTransfer.dropEffect = "copy";
            },
            style: { backgroundImage: "radial-gradient(circle, var(--cv-dot) 1px, transparent 1px)", backgroundSize: `${$n}px ${$n}px`, backgroundPosition: `${dt.x}px ${dt.y}px` },
            minZoom: 0.15,
            maxZoom: 2.5,
            panOnDrag: w ? !0 : [1, 2],
            selectionOnDrag: !w,
            selectionMode: fo.Partial,
            panOnScroll: !0,
            zoomOnScroll: !1,
            zoomOnPinch: !0,
            multiSelectionKeyCode: "Shift",
            panActivationKeyCode: "Space",
            deleteKeyCode: null,
            colorMode: en,
            onlyRenderVisibleElements: !0,
            preventScrolling: !0,
            fitView: !1,
            nodesDraggable: !w && !p,
            elementsSelectable: !w,
            ariaLabelConfig: {
              "node.a11yDescription.default": "按 Enter 选中节点，方向键移动，Delete 删除。",
              "edge.a11yDescription.default": "按 Enter 选中连线，Delete 移除引用。",
              "controls.zoomIn.ariaLabel": "放大",
              "controls.zoomOut.ariaLabel": "缩小"
            },
            children: N && /* @__PURE__ */ d.jsx(
              Yk,
              {
                pannable: !0,
                zoomable: !0,
                position: "bottom-left",
                nodeColor: "var(--cv-map-node)",
                maskColor: "var(--cv-map-mask)",
                style: { bottom: 64, left: 12 }
              }
            )
          }
        ) }),
        /* @__PURE__ */ d.jsxs("header", { className: "canvas-header", children: [
          /* @__PURE__ */ d.jsxs("div", { className: "project-heading", children: [
            /* @__PURE__ */ d.jsx(Dw, {}),
            /* @__PURE__ */ d.jsx(
              "input",
              {
                "aria-label": "画布名称",
                value: s.value.title,
                maxLength: 80,
                onFocus: s.begin,
                onChange: (b) => s.change((U) => ({ ...U, title: b.target.value }), !1),
                onBlur: () => {
                  s.ref.current.title.trim() || s.change((b) => ({ ...b, title: "未命名画布" }), !1), s.end();
                },
                onKeyDown: (b) => {
                  b.key === "Enter" && b.currentTarget.blur();
                }
              }
            ),
            /* @__PURE__ */ d.jsx("span", { className: "menu-trigger", children: /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: hs,
                label: "项目菜单",
                "aria-expanded": he === "project",
                onClick: () => Ee(he === "project" ? null : "project")
              }
            ) }),
            /* @__PURE__ */ d.jsxs("span", { className: "node-count", children: [
              "节点 ",
              na.length
            ] }),
            /* @__PURE__ */ d.jsx(
              "button",
              {
                className: "save-state " + (["error", "conflict"].includes(s.status) ? "save-error" : ""),
                onClick: () => {
                  s.status === "error" && s.flush().catch((b) => Pe(b.message));
                },
                title: s.error || "自动保存",
                children: s.status === "saved" ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                  /* @__PURE__ */ d.jsx(pi, { size: 13 }),
                  "已保存"
                ] }) : s.status === "saving" || s.status === "dirty" ? /* @__PURE__ */ d.jsx(d.Fragment, { children: "保存中" }) : s.status === "conflict" ? "保存冲突" : "保存失败，重试"
              }
            )
          ] }),
          /* @__PURE__ */ d.jsxs("div", { className: "global-tools", children: [
            /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: np,
                label: "搜索节点",
                onClick: () => {
                  Tt(""), Y("search");
                }
              }
            ),
            /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: dx,
                label: "生成历史",
                onClick: () => Y("history")
              }
            ),
            /* @__PURE__ */ d.jsx(pt, { icon: gb, label: "AI 分镜", onClick: () => $e(!0) }),
            /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: hx,
                label: "镜头列表",
                onClick: () => ze(!0)
              }
            ),
            /* @__PURE__ */ d.jsx(
              pt,
              {
                icon: Nm,
                label: "所有画布",
                onClick: () => Ll("/canvas")
              }
            )
          ] })
        ] }),
        he === "project" && /* @__PURE__ */ d.jsxs("div", { className: "cv-menu project-menu", children: [
          /* @__PURE__ */ d.jsxs("button", { onClick: () => Ll("/canvas"), children: [
            /* @__PURE__ */ d.jsx(Af, { size: 16 }),
            "所有画布"
          ] }),
          /* @__PURE__ */ d.jsxs(
            "button",
            {
              onClick: async () => {
                try {
                  await s.flush();
                  const b = await ln("/api/canvases", {});
                  location.assign(sl("/canvas/" + b.id));
                } catch (b) {
                  Pe(b.message);
                }
              },
              children: [
                /* @__PURE__ */ d.jsx(La, { size: 16 }),
                "新建画布"
              ]
            }
          ),
          /* @__PURE__ */ d.jsxs(
            "button",
            {
              onClick: async () => {
                try {
                  await s.flush();
                  const b = await ln(
                    `/api/canvases/${n.id}/duplicate`,
                    {}
                  );
                  location.assign(sl("/canvas/" + b.id));
                } catch (b) {
                  Pe(b.message);
                }
              },
              children: [
                /* @__PURE__ */ d.jsx(Pr, { size: 16 }),
                "复制画布"
              ]
            }
          ),
          /* @__PURE__ */ d.jsxs(
            "button",
            {
              onClick: () => {
                xx(s.value.title, s.value), Ee(null);
              },
              children: [
                /* @__PURE__ */ d.jsx(Xs, { size: 16 }),
                "下载画布文档"
              ]
            }
          ),
          /* @__PURE__ */ d.jsx("div", { className: "menu-divider" }),
          /* @__PURE__ */ d.jsxs("button", { onClick: () => Ll("/studio"), children: [
            /* @__PURE__ */ d.jsx(Cf, { size: 16 }),
            "返回工作台"
          ] })
        ] }),
        /* @__PURE__ */ d.jsxs("aside", { className: "insert-toolbar", "aria-label": "添加节点", children: [
          ["text", "image", "video", "sticky"].map((b) => /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: wc[b],
              label: "添加" + bc[b],
              onClick: () => ci(b)
            },
            b
          )),
          /* @__PURE__ */ d.jsx("div", { className: "menu-divider" }),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: Nm,
              label: "资产库",
              onClick: () => {
                B(null), dn("all"), zn(/* @__PURE__ */ new Set()), Y("assets");
              }
            }
          ),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: lp,
              label: "上传图片",
              disabled: pe !== null,
              onClick: () => {
                rn.current = null, hn.current?.click();
              }
            }
          )
        ] }),
        /* @__PURE__ */ d.jsx(
          "input",
          {
            ref: hn,
            type: "file",
            accept: Y4,
            multiple: !0,
            hidden: !0,
            onChange: (b) => {
              rr([...b.target.files || []]);
            }
          }
        ),
        !na.length && /* @__PURE__ */ d.jsxs("div", { className: "canvas-empty", children: [
          /* @__PURE__ */ d.jsx("p", { children: "从一个节点开始" }),
          /* @__PURE__ */ d.jsxs("div", { children: [
            /* @__PURE__ */ d.jsxs("button", { onClick: () => ci("text"), children: [
              /* @__PURE__ */ d.jsx(ap, { size: 18 }),
              "文本"
            ] }),
            /* @__PURE__ */ d.jsxs("button", { onClick: () => ci("image"), children: [
              /* @__PURE__ */ d.jsx(xf, { size: 18 }),
              "图片"
            ] }),
            /* @__PURE__ */ d.jsxs("button", { onClick: () => ci("video"), children: [
              /* @__PURE__ */ d.jsx(Jr, { size: 18 }),
              "视频"
            ] })
          ] })
        ] }),
        K && !p && /* @__PURE__ */ d.jsxs("div", { className: "selection-toolbar", style: fr, children: [
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: Pr,
              label: "复制副本",
              onClick: () => on(!0)
            }
          ),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: mx,
              label: "聚焦节点",
              onClick: () => yt([K.id])
            }
          ),
          /* @__PURE__ */ d.jsx("span", { className: "menu-trigger", children: /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: nN,
              label: "颜色标签",
              onClick: () => Ee(he === "colors" ? null : "colors")
            }
          ) }),
          (at?.media || ["text", "sticky"].includes(K.type)) && /* @__PURE__ */ d.jsx(pt, { icon: Xs, label: "下载", onClick: sa }),
          /* @__PURE__ */ d.jsx(pt, { icon: Qs, label: "删除节点", onClick: la }),
          K.type === "video" && /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: hx,
              label: Qt.includes(K.id) ? "查看镜头列表" : "加入镜头列表",
              onClick: () => Qt.includes(K.id) ? ze(!0) : ui(K)
            }
          ),
          K.type === "image" && at?.media && tn.length > 0 && /* @__PURE__ */ d.jsx(pt, { icon: Tm, label: "应用参考图到镜头", onClick: () => ya(K.id) }),
          K.type === "image" && at?.media && /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: dN,
              label: "替换内容",
              onClick: () => {
                B(K.id), dn("image"), zn(/* @__PURE__ */ new Set()), Y("assets");
              }
            }
          ),
          Kn.length > 0 && /* @__PURE__ */ d.jsx("span", { className: "menu-trigger", children: /* @__PURE__ */ d.jsxs(
            "button",
            {
              className: "version-button",
              onClick: () => Ee(he === "versions" ? null : "versions"),
              children: [
                K.active_job ? "已采用" : "版本",
                " ",
                /* @__PURE__ */ d.jsx(hs, { size: 14 })
              ]
            }
          ) }),
          he === "colors" && /* @__PURE__ */ d.jsx("div", { className: "cv-menu color-menu", children: X4.map((b, U) => /* @__PURE__ */ d.jsx(
            "button",
            {
              className: "color-choice " + b,
              "aria-label": rb[U],
              title: rb[U],
              "aria-pressed": K.color === b,
              onClick: () => {
                zt(K.id, { color: b }), Ee(null);
              },
              children: K.color === b && /* @__PURE__ */ d.jsx(pi, { size: 15 })
            },
            b
          )) }),
          he === "versions" && /* @__PURE__ */ d.jsxs("div", { className: "cv-menu versions-menu", children: [
            /* @__PURE__ */ d.jsxs(
              "button",
              {
                onClick: () => {
                  zt(K.id, { active_job: null, use_media: !1 }), Ee(null);
                },
                children: [
                  "跟随最新版本",
                  !K.active_job && !K.use_media && /* @__PURE__ */ d.jsx(pi, { size: 14 })
                ]
              }
            ),
            K.type === "video" && Kn.length > 1 && /* @__PURE__ */ d.jsxs("button", { onClick: () => {
              It(K.id), Ee(null);
            }, children: [
              /* @__PURE__ */ d.jsx(zE, { size: 16 }),
              " 并排对比"
            ] }),
            Kn.map((b) => /* @__PURE__ */ d.jsxs(
              "button",
              {
                onClick: () => {
                  zt(K.id, { active_job: b.id, use_media: !1 }), Ee(null);
                },
                children: [
                  K.active_job === b.id ? "版本" : "采用",
                  " #",
                  b.id,
                  " ",
                  /* @__PURE__ */ d.jsx("span", { children: new Date(b.created * 1e3).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  }) }),
                  K.active_job === b.id && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                    "已采用 ",
                    /* @__PURE__ */ d.jsx(pi, { size: 14 })
                  ] })
                ]
              },
              b.id
            ))
          ] })
        ] }),
        m.length > 1 && /* @__PURE__ */ d.jsxs("div", { className: "multi-toolbar", children: [
          /* @__PURE__ */ d.jsxs("span", { children: [
            "已选 ",
            m.length,
            " 个节点"
          ] }),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: Pr,
              label: "复制副本",
              onClick: () => on(!0)
            }
          ),
          /* @__PURE__ */ d.jsx(pt, { icon: Af, label: "宫格布局", onClick: vs }),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: Xs,
              label: "批量下载",
              onClick: sa
            }
          ),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: Qs,
              label: "删除所选节点",
              onClick: la
            }
          )
        ] }),
        cr && /* @__PURE__ */ d.jsxs(
          "section",
          {
            className: "node-composer",
            ref: ee,
            style: _a,
            "aria-label": K.type === "image" ? "图片生成器" : "视频生成器",
            children: [
              qi.length > 0 && !Rn && /* @__PURE__ */ d.jsxs("div", { className: "reference-list", children: [
                qi.map(({ node: b, edge: U }, G) => {
                  const re = Oi(b, f).media;
                  return /* @__PURE__ */ d.jsxs(
                    "div",
                    {
                      className: "reference-chip",
                      title: b.title,
                      children: [
                        re ? /* @__PURE__ */ d.jsx("img", { src: Si(re), alt: b.title }) : /* @__PURE__ */ d.jsx(ap, { size: 17 }),
                        /* @__PURE__ */ d.jsx("span", { children: b.title }),
                        /* @__PURE__ */ d.jsxs("div", { className: "reference-actions", children: [
                          G > 0 && /* @__PURE__ */ d.jsx(
                            pt,
                            {
                              icon: EE,
                              label: "前移 " + b.title,
                              onClick: () => s.change((F) => {
                                const _e = [...F.document.edges], Be = _e.findIndex((tt) => tt.id === U.id), De = _e.findIndex(
                                  (tt) => tt.id === qi[G - 1].edge.id
                                );
                                return [_e[Be], _e[De]] = [_e[De], _e[Be]], {
                                  ...F,
                                  document: { ...F.document, edges: _e }
                                };
                              })
                            }
                          ),
                          /* @__PURE__ */ d.jsx(
                            pt,
                            {
                              icon: wi,
                              label: "移除引用 " + b.title,
                              onClick: () => s.change((F) => ({
                                ...F,
                                document: {
                                  ...F.document,
                                  edges: F.document.edges.filter(
                                    (_e) => _e.id !== U.id
                                  )
                                }
                              }))
                            }
                          )
                        ] })
                      ]
                    },
                    U.id
                  );
                }),
                /* @__PURE__ */ d.jsx(
                  "button",
                  {
                    className: "add-reference",
                    "aria-label": "添加引用",
                    onClick: () => {
                      Tt(""), Y("references");
                    },
                    children: /* @__PURE__ */ d.jsx(La, { size: 17 })
                  }
                ),
                be && /* @__PURE__ */ d.jsx("button", { className: "crop-trigger", onClick: () => Qn(!0), children: "首帧裁切" })
              ] }),
              Rn && /* @__PURE__ */ d.jsx(TN, { options: Jn, ids: xe, assets: r.assets, onChange: sd, onAsset: (b) => o((U) => ({ ...U, assets: [{ ...b, owner: U.me.id }, ...U.assets] })), onMention: (b) => zt(K.id, { prompt: K.prompt + b + " " }), onBusy: Dl }, K.id),
              !Ti && /* @__PURE__ */ d.jsx("div", { className: "canvas-pack-entry", children: /* @__PURE__ */ d.jsxs("button", { className: "secondary", onClick: () => Ge(K.id), children: [
                /* @__PURE__ */ d.jsx(Nm, { size: 15 }),
                "素材包",
                K.asset_packs?.length ? ` · ${K.asset_packs.length}` : ""
              ] }) }),
              Rn ? /* @__PURE__ */ d.jsx(rE, { value: K.prompt, ids: xe, assets: r.assets, frames: Ti, onChange: (b) => zt(K.id, { prompt: b }, !1), onFocus: s.begin, onBlur: s.end }) : /* @__PURE__ */ d.jsx(
                "textarea",
                {
                  className: "composer-prompt",
                  "aria-label": "生成提示词",
                  placeholder: `描述你想生成的${K.type === "image" ? "图片" : "视频"}，或连接文本作为参考`,
                  value: K.prompt,
                  maxLength: 12e3,
                  onFocus: s.begin,
                  onChange: (b) => zt(K.id, { prompt: b.target.value }, !1),
                  onBlur: s.end
                }
              ),
              ht?.mode === "extend" && /* @__PURE__ */ d.jsxs("label", { className: "cv-flow-source", children: [
                "来源视频",
                /* @__PURE__ */ d.jsxs("select", { "aria-label": "画布续写来源视频", value: K.params.flow_source_job || "", onChange: (b) => qn({ flow_source_job: Number(b.target.value) || null }), children: [
                  /* @__PURE__ */ d.jsx("option", { value: "", children: "请选择已完成的 Flow 视频" }),
                  Ga.map((b) => /* @__PURE__ */ d.jsxs("option", { value: b.id, children: [
                    "#",
                    b.id,
                    " · ",
                    b.prompt.slice(0, 42)
                  ] }, b.id))
                ] })
              ] }),
              ml && /* @__PURE__ */ d.jsx("p", { className: "cv-flow-hint", role: "status", children: ml }),
              /* @__PURE__ */ d.jsxs("div", { className: "composer-bottom", children: [
                /* @__PURE__ */ d.jsxs("div", { className: "parameter-wrap menu-trigger", onKeyDown: bn, children: [
                  /* @__PURE__ */ d.jsxs("button", { ref: Mt, className: "parameter" + (nn(rt) ? "" : " model-unavailable"), disabled: !rt, "aria-label": "选择模型", "aria-haspopup": "listbox", "aria-controls": "canvas-model-options", "aria-expanded": he === "model", onClick: () => he === "model" ? qt() : Ee("model"), children: [
                    rt ? yb(r.model_catalog, rt) : "无模型",
                    /* @__PURE__ */ d.jsx(hs, { size: 13 })
                  ] }),
                  he === "model" && /* @__PURE__ */ d.jsxs("div", { ref: ri, id: "canvas-model-options", className: "cv-menu duration-menu model-menu", role: "listbox", "aria-label": "选择模型", children: [
                    Ui.length > 12 && /* @__PURE__ */ d.jsx("input", { className: "cv-model-search", "aria-label": "搜索画布模型", placeholder: "搜索模型", value: yn, onChange: (b) => Wt(b.target.value), onKeyDown: (b) => {
                      b.stopPropagation(), b.key === "Escape" && qt();
                    } }),
                    " ",
                    Ui.filter(([, b]) => b.toLowerCase().includes(yn.toLowerCase())).map(([b, U]) => /* @__PURE__ */ d.jsxs("button", { role: "option", "aria-selected": Ec(r.model_catalog, rt, b), tabIndex: Ec(r.model_catalog, rt, b) ? 0 : -1, onClick: () => {
                      const G = b.startsWith("muse-"), re = G ? K.type === "image" ? ["1:1", "16:9", "9:16", "4:3", "3:4"] : ["16:9", "9:16"] : r.ratios, F = r.model_catalog?.[b];
                      qn(F?.provider === "flow" ? { model: b, ratio: F.ratio, seconds: F.seconds, resolution: F.resolution === "原生" ? "1K" : F.resolution, flow_source_job: null } : { model: b, ratio: re.includes(K.params.ratio) ? K.params.ratio : "16:9", seconds: G ? 6 : 5, flow_source_job: null }), Wt(""), qt();
                    }, children: [
                      U,
                      Ec(r.model_catalog, rt, b) && /* @__PURE__ */ d.jsx(pi, { size: 14 })
                    ] }, b))
                  ] })
                ] }),
                Rn && /* @__PURE__ */ d.jsxs("div", { className: "parameter-wrap menu-trigger", children: [
                  /* @__PURE__ */ d.jsxs("button", { className: "parameter", disabled: Ol, "aria-haspopup": "listbox", "aria-expanded": he === "h3-mode", onClick: () => Ee(he === "h3-mode" ? null : "h3-mode"), children: [
                    Ti ? /* @__PURE__ */ d.jsx(Jr, { size: 15 }) : /* @__PURE__ */ d.jsx(Tm, { size: 15 }),
                    " ",
                    Ti ? "首尾帧" : "全能参考",
                    /* @__PURE__ */ d.jsx(hs, { size: 13 })
                  ] }),
                  he === "h3-mode" && /* @__PURE__ */ d.jsx("div", { className: "cv-menu duration-menu", role: "listbox", "aria-label": "参考模式", children: ["reference", "frames"].map((b) => /* @__PURE__ */ d.jsxs("button", { role: "option", "aria-selected": Jn.mode === b, onClick: () => bo(b), children: [
                    b === "frames" ? "首尾帧" : "全能参考",
                    Jn.mode === b && /* @__PURE__ */ d.jsx(pi, { size: 14 })
                  ] }, b)) })
                ] }),
                /* @__PURE__ */ d.jsxs("div", { className: "parameter-wrap menu-trigger", children: [
                  /* @__PURE__ */ d.jsxs(
                    "button",
                    {
                      className: "parameter " + (ht && !kn ? "fixed-parameter " : "") + (he === "format" ? "active" : ""),
                      disabled: !!(ht && !kn),
                      "aria-label": kn ? "选择生成方式和比例" : "选择比例和分辨率",
                      onClick: () => Ee(he === "format" ? null : "format"),
                      children: [
                        /* @__PURE__ */ d.jsx(ip, { size: 14 }),
                        Ti && z.length ? "自动" : K.params.ratio,
                        /* @__PURE__ */ d.jsx("span", { children: ht ? ht.resolution : ea ? "原生" : K.type === "image" ? K.params.resolution : K.params.quality + "P" })
                      ]
                    }
                  ),
                  he === "format" && /* @__PURE__ */ d.jsxs("div", { className: "cv-menu parameter-menu", children: [
                    kn && kn.modes.length > 1 && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                      /* @__PURE__ */ d.jsx("span", { className: "menu-label", children: "生成方式" }),
                      /* @__PURE__ */ d.jsx("div", { className: "resolution-options", role: "group", "aria-label": "生成方式", children: kn.modes.map((b) => /* @__PURE__ */ d.jsx("button", { className: ht?.mode === b ? "active" : "", onClick: () => qn({}, b), children: CN[b] }, b)) })
                    ] }),
                    /* @__PURE__ */ d.jsx("span", { className: "menu-label", children: "选择比例" }),
                    /* @__PURE__ */ d.jsx("div", { className: "ratio-options", children: (kn ? kn.ratios : ea ? K.type === "image" ? ["1:1", "16:9", "9:16", "4:3", "3:4"] : ["16:9", "9:16"] : ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).map((b) => /* @__PURE__ */ d.jsxs(
                      "button",
                      {
                        disabled: Ti && z.length > 0,
                        className: K.params.ratio === b ? "active" : "",
                        onClick: () => qn({ ratio: b }),
                        children: [
                          /* @__PURE__ */ d.jsx(
                            "span",
                            {
                              className: "ratio-icon",
                              style: { aspectRatio: b.replace(":", "/") }
                            }
                          ),
                          b
                        ]
                      },
                      b
                    )) }),
                    !ea && !ht && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                      /* @__PURE__ */ d.jsx("span", { className: "menu-label", children: "选择分辨率" }),
                      /* @__PURE__ */ d.jsx("div", { className: "resolution-options", children: (K.type === "image" ? ["1K", "2K"] : [480, 768]).map(
                        (b) => /* @__PURE__ */ d.jsxs(
                          "button",
                          {
                            className: (K.type === "image" ? K.params.resolution : K.params.quality) === b ? "active" : "",
                            onClick: () => qn(
                              K.type === "image" ? { resolution: b } : { quality: b }
                            ),
                            children: [
                              b,
                              K.type === "video" ? "P" : ""
                            ]
                          },
                          b
                        )
                      ) })
                    ] })
                  ] })
                ] }),
                !((ea || ht) && K.type === "image") && /* @__PURE__ */ d.jsxs("div", { className: "parameter-wrap menu-trigger", children: [
                  /* @__PURE__ */ d.jsxs(
                    "button",
                    {
                      className: "parameter",
                      disabled: !!(ht && !kn),
                      "aria-label": K.type === "image" ? "图片质量" : "视频时长",
                      onClick: () => Ee(he === "duration" ? null : "duration"),
                      children: [
                        K.type === "image" ? /* @__PURE__ */ d.jsx(px, { size: 15 }) : /* @__PURE__ */ d.jsx(dx, { size: 15 }),
                        /* @__PURE__ */ d.jsx("span", { children: K.type === "image" ? { low: "草稿", medium: "标准", high: "高清" }[K.params.image_quality] : K.params.seconds + "s" }),
                        /* @__PURE__ */ d.jsx(hs, { size: 13 })
                      ]
                    }
                  ),
                  he === "duration" && /* @__PURE__ */ d.jsx("div", { className: "cv-menu duration-menu", children: (K.type === "image" ? ["low", "medium", "high"] : kn ? kn.seconds : ea ? [5, 6, 8, 10] : [5, 10, 15]).map((b) => /* @__PURE__ */ d.jsxs(
                    "button",
                    {
                      onClick: () => {
                        qn(
                          K.type === "image" ? { image_quality: b } : { seconds: b }
                        ), Ee(null);
                      },
                      children: [
                        K.type === "image" ? { low: "草稿", medium: "标准", high: "高清" }[b] : b + "s",
                        (K.type === "image" ? K.params.image_quality : K.params.seconds) === b && /* @__PURE__ */ d.jsx(pi, { size: 14 })
                      ]
                    },
                    b
                  )) })
                ] }),
                /* @__PURE__ */ d.jsx(
                  pt,
                  {
                    icon: mb,
                    label: "引用画布节点",
                    onClick: () => {
                      Tt(""), Y("references");
                    }
                  }
                ),
                K.type === "video" && rt === "MiniMax H3" && /* @__PURE__ */ d.jsxs("div", { className: "parameter-wrap menu-trigger", children: [
                  /* @__PURE__ */ d.jsx(
                    pt,
                    {
                      icon: px,
                      label: "更多设置",
                      onClick: () => Ee(he === "advanced" ? null : "advanced")
                    }
                  ),
                  he === "advanced" && /* @__PURE__ */ d.jsxs("div", { className: "cv-menu seed-menu", children: [
                    /* @__PURE__ */ d.jsxs("div", { className: "advanced-mode-row", children: [
                      /* @__PURE__ */ d.jsx("span", { children: "快速模式" }),
                      /* @__PURE__ */ d.jsx(
                        "button",
                        {
                          type: "button",
                          role: "switch",
                          "aria-label": "快速模式",
                          "aria-checked": !!K.params.fast_mode,
                          className: "cv-fast-switch",
                          onClick: () => qn({ fast_mode: !K.params.fast_mode }),
                          children: /* @__PURE__ */ d.jsx("span", { "aria-hidden": "true" })
                        }
                      )
                    ] }),
                    !K.params.fast_mode && /* @__PURE__ */ d.jsxs("div", { children: [
                      /* @__PURE__ */ d.jsx("div", { className: "sampling-label", children: "采样步数" }),
                      /* @__PURE__ */ d.jsx("div", { className: "sampling-options", role: "radiogroup", "aria-label": "采样步数", children: [16, 20, 32, 50].map((b) => /* @__PURE__ */ d.jsx(
                        "button",
                        {
                          type: "button",
                          role: "radio",
                          "aria-checked": (K.params.sampling_steps ?? 20) === b,
                          tabIndex: (K.params.sampling_steps ?? 20) === b ? 0 : -1,
                          onClick: () => qn({ sampling_steps: b }),
                          onKeyDown: (U) => {
                            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(U.key)) return;
                            U.preventDefault(), U.stopPropagation();
                            const G = [16, 20, 32, 50], re = ["ArrowLeft", "ArrowUp"].includes(U.key) ? -1 : 1, F = (G.indexOf(b) + re + 4) % 4;
                            qn({ sampling_steps: G[F] }), U.currentTarget.parentElement?.children[F]?.focus();
                          },
                          children: b
                        },
                        b
                      )) })
                    ] }),
                    /* @__PURE__ */ d.jsx(
                      "input",
                      {
                        type: "number",
                        "aria-label": "随机种子",
                        min: 0,
                        max: Number.MAX_SAFE_INTEGER,
                        placeholder: "随机种子（留空随机）",
                        value: K.params.seed ?? "",
                        onChange: (b) => {
                          const U = b.target.value === "" ? null : Number(b.target.value);
                          (U === null || Number.isSafeInteger(U) && U >= 0) && qn({ seed: U });
                        }
                      }
                    )
                  ] })
                ] }),
                /* @__PURE__ */ d.jsxs("div", { className: "parameter-wrap menu-trigger", children: [
                  /* @__PURE__ */ d.jsxs(
                    "button",
                    {
                      className: "parameter " + (he === "candidates" ? "active" : ""),
                      "aria-label": "候选数量",
                      "aria-expanded": he === "candidates",
                      onClick: () => Ee(he === "candidates" ? null : "candidates"),
                      children: [
                        it,
                        " 个",
                        /* @__PURE__ */ d.jsx(hs, { size: 13 })
                      ]
                    }
                  ),
                  he === "candidates" && /* @__PURE__ */ d.jsx("div", { className: "cv-menu duration-menu candidate-menu", role: "group", "aria-label": "候选数量", children: [1, 2].map((b) => /* @__PURE__ */ d.jsxs(
                    "button",
                    {
                      "aria-pressed": it === b,
                      onClick: () => {
                        At(b), Ee(null);
                      },
                      children: [
                        /* @__PURE__ */ d.jsxs("span", { children: [
                          b,
                          " 个候选"
                        ] }),
                        it === b && /* @__PURE__ */ d.jsx(pi, { size: 16 })
                      ]
                    },
                    b
                  )) })
                ] }),
                /* @__PURE__ */ d.jsx("span", { className: "canvas-credit", "aria-label": rt ? wa == null ? "未定价" : `${di} 积分${bs ? "" : "，余额不足"}` : "", title: `当前空间可用 ${r.credits.available} 积分${wa != null && !bs ? "，余额不足" : ""}`, children: rt ? wa == null ? "未定价" : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                  /* @__PURE__ */ d.jsx("svg", { className: "credit-spark", viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ d.jsx("path", { d: "M12 2C13.4 8.7 15.3 10.6 22 12C15.3 13.4 13.4 15.3 12 22C10.6 15.3 8.7 13.4 2 12C8.7 10.6 10.6 8.7 12 2Z" }) }),
                  /* @__PURE__ */ d.jsx("span", { children: di })
                ] }) : "" }),
                /* @__PURE__ */ d.jsx(
                  "button",
                  {
                    className: "generate-button",
                    "aria-label": "生成",
                    disabled: !or,
                    onClick: () => it === 2 ? Et(!0) : void Bn(),
                    title: K.type === "image" && !oi ? "图片生成已关闭" : ba ? "参考内容尚未就绪" : "生成",
                    children: L === K.id ? /* @__PURE__ */ d.jsx(If, { size: 20, className: "spin" }) : /* @__PURE__ */ d.jsx(_c, { size: 21 })
                  }
                )
              ] }),
              qe && /* @__PURE__ */ d.jsxs("p", { className: "composer-message", children: [
                "参考或参数已变更，下一次生成会使用新设置。",
                K.active_job ? "已采用版本保持不变。" : ""
              ] }),
              ba && /* @__PURE__ */ d.jsx("div", { className: "composer-message", children: /* @__PURE__ */ d.jsxs(
                "button",
                {
                  onClick: () => {
                    jn(ba.node.id), yt([ba.node.id]);
                  },
                  children: [
                    "“",
                    ba.node.title,
                    "”尚未就绪 ",
                    /* @__PURE__ */ d.jsx(pb, { size: 12 })
                  ]
                }
              ) }),
              at?.latest?.status === "failed" && /* @__PURE__ */ d.jsx("p", { className: "composer-message error", children: at.latest.note }),
              Hl.map((b) => /* @__PURE__ */ d.jsxs("div", { className: "composer-message", children: [
                /* @__PURE__ */ d.jsxs("span", { children: [
                  b.batch?.count === 2 ? `候选 ${b.batch.index} · ` : "",
                  Hw(b) || Nf[b.status]
                ] }),
                b.status === "queued" && (b.owner === r.me.id || r.me.role === "admin") && /* @__PURE__ */ d.jsx("button", { onClick: async () => {
                  try {
                    await ln(`/api/jobs/${b.id}/cancel`, {}), await ga();
                  } catch (U) {
                    Pe(U.message);
                  }
                }, children: "取消任务" }),
                b.status === "done" && b.result && K.active_job !== b.id && /* @__PURE__ */ d.jsx("button", { onClick: () => zt(K.id, { active_job: b.id, use_media: !1 }), children: "采用" }),
                b.status === "done" && K.active_job === b.id && /* @__PURE__ */ d.jsx("span", { children: "已采用" })
              ] }, b.id))
            ]
          }
        ),
        /* @__PURE__ */ d.jsxs("footer", { className: "viewport-dock", children: [
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: eN,
              label: "选择 V",
              active: !w,
              onClick: () => E(!1)
            }
          ),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: BE,
              label: "抓手 H",
              active: w,
              onClick: () => E(!0)
            }
          ),
          /* @__PURE__ */ d.jsx("span", { className: "dock-divider" }),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: QE,
              label: "小地图",
              active: N,
              onClick: () => _(!N)
            }
          ),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: C ? Tm : YE,
              label: C ? "隐藏连线" : "显示连线",
              onClick: () => D(!C)
            }
          ),
          /* @__PURE__ */ d.jsx("span", { className: "menu-trigger", children: /* @__PURE__ */ d.jsxs(
            "button",
            {
              className: "zoom-button",
              "aria-label": "缩放菜单",
              onClick: () => Ee(he === "zoom" ? null : "zoom"),
              children: [
                Math.round(dt.zoom * 100),
                "%",
                /* @__PURE__ */ d.jsx(hs, { size: 12 })
              ]
            }
          ) }),
          /* @__PURE__ */ d.jsx("span", { className: "dock-divider" }),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: gx,
              label: "撤销 ⌘Z",
              disabled: !s.canUndo,
              onClick: () => s.travel()
            }
          ),
          /* @__PURE__ */ d.jsx(
            pt,
            {
              icon: uN,
              label: "重做 ⌘⇧Z",
              disabled: !s.canRedo,
              onClick: () => s.travel(!0)
            }
          ),
          he === "zoom" && /* @__PURE__ */ d.jsxs("div", { className: "cv-menu zoom-menu", children: [
            /* @__PURE__ */ d.jsxs(
              "button",
              {
                onClick: () => {
                  yt(na.map((b) => b.id)), Ee(null);
                },
                children: [
                  /* @__PURE__ */ d.jsx(mx, { size: 16 }),
                  "适配画布",
                  /* @__PURE__ */ d.jsx("span", { children: "⇧1" })
                ]
              }
            ),
            /* @__PURE__ */ d.jsxs(
              "button",
              {
                disabled: !m.length,
                onClick: () => {
                  yt(m), Ee(null);
                },
                children: [
                  "聚焦选中项",
                  /* @__PURE__ */ d.jsx("span", { children: "⇧2" })
                ]
              }
            ),
            [0.25, 0.5, 1, 2].map((b) => /* @__PURE__ */ d.jsxs(
              "button",
              {
                onClick: () => {
                  xn.zoomTo(b, { duration: 160 }), Ee(null);
                },
                children: [
                  b * 100,
                  "%",
                  Math.abs(dt.zoom - b) < 0.01 && /* @__PURE__ */ d.jsx(pi, { size: 14 })
                ]
              },
              b
            ))
          ] })
        ] }),
        X && /* @__PURE__ */ d.jsxs(
          "div",
          {
            className: "cv-menu downstream-menu",
            style: {
              left: Math.min(
                Fe.w - 190,
                Math.max(80, (wn?.x || 100) + (wn?.w || 200) + 35)
              ),
              top: Math.min(
                Fe.h - 160,
                Math.max(80, (wn?.y || 100) + (wn?.h || 100) / 2)
              )
            },
            children: [
              /* @__PURE__ */ d.jsx("span", { className: "menu-label", children: "新建连接" }),
              /* @__PURE__ */ d.jsxs(
                "button",
                {
                  disabled: !Ot,
                  onClick: () => ci("image", X),
                  children: [
                    /* @__PURE__ */ d.jsx(xf, { size: 16 }),
                    "图片生成"
                  ]
                }
              ),
              /* @__PURE__ */ d.jsxs("button", { onClick: () => ci("video", X), children: [
                /* @__PURE__ */ d.jsx(Jr, { size: 16 }),
                "视频生成"
              ] })
            ]
          }
        ),
        I && /* @__PURE__ */ d.jsxs(
          "div",
          {
            className: "cv-menu context-menu",
            style: {
              left: Math.min(I.x, Fe.w - 210),
              top: Math.min(I.y, Fe.h - 300)
            },
            children: [
              I.node ? /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                /* @__PURE__ */ d.jsxs(
                  "button",
                  {
                    onClick: () => {
                      Pn(), ae(null);
                    },
                    children: [
                      /* @__PURE__ */ d.jsx(Pr, { size: 16 }),
                      "复制",
                      /* @__PURE__ */ d.jsx("span", { children: "⌘C" })
                    ]
                  }
                ),
                /* @__PURE__ */ d.jsxs("button", { onClick: () => on(!0), children: [
                  "复制副本",
                  /* @__PURE__ */ d.jsx("span", { children: "⌘D" })
                ] }),
                /* @__PURE__ */ d.jsxs("button", { onClick: sa, children: [
                  /* @__PURE__ */ d.jsx(Xs, { size: 16 }),
                  "下载"
                ] }),
                /* @__PURE__ */ d.jsx("div", { className: "menu-divider" }),
                /* @__PURE__ */ d.jsxs("button", { onClick: la, children: [
                  /* @__PURE__ */ d.jsx(Qs, { size: 16 }),
                  "删除节点"
                ] })
              ] }) : /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
                ["text", "image", "video", "sticky"].map((b) => /* @__PURE__ */ d.jsxs(
                  "button",
                  {
                    onClick: () => ci(
                      b,
                      void 0,
                      xn.screenToFlowPosition({ x: I.x, y: I.y })
                    ),
                    children: [
                      yc.createElement(wc[b], { size: 16 }),
                      bc[b]
                    ]
                  },
                  b
                )),
                /* @__PURE__ */ d.jsx("div", { className: "menu-divider" }),
                /* @__PURE__ */ d.jsxs("button", { disabled: !oe.current, onClick: () => on(), children: [
                  "粘贴",
                  /* @__PURE__ */ d.jsx("span", { children: "⌘V" })
                ] })
              ] }),
              /* @__PURE__ */ d.jsx("div", { className: "menu-divider" }),
              /* @__PURE__ */ d.jsxs(
                "button",
                {
                  disabled: !s.canUndo,
                  onClick: () => {
                    s.travel(), ae(null);
                  },
                  children: [
                    /* @__PURE__ */ d.jsx(gx, { size: 16 }),
                    "撤销"
                  ]
                }
              )
            ]
          }
        ),
        s.status === "conflict" && /* @__PURE__ */ d.jsxs("div", { className: "save-banner", role: "alert", children: [
          /* @__PURE__ */ d.jsx("span", { children: "画布已被其他成员修改，你的修改已保留。" }),
          /* @__PURE__ */ d.jsx(
            "button",
            {
              onClick: () => xx(s.value.title + "-本地副本", s.value),
              children: "下载本地副本"
            }
          ),
          /* @__PURE__ */ d.jsx("button", { onClick: () => we(() => () => s.reload()), children: "重新载入" })
        ] }),
        pe !== null && /* @__PURE__ */ d.jsxs("div", { className: "upload-progress", role: "status", children: [
          "正在上传 ",
          pe,
          "%"
        ] }),
        M && /* @__PURE__ */ d.jsx("div", { className: "canvas-toast", role: "status", children: M }),
        [.../* @__PURE__ */ new Set([...Q, ...K?.type === "text" ? [K.id] : []])].map((b) => {
          const U = s.value.document.nodes.find((re) => re.id === b && re.type === "text");
          if (!U) return null;
          const G = K?.id === b && !p;
          return /* @__PURE__ */ d.jsx("section", { ref: G ? H : void 0, className: "node-composer text-node-composer", style: { ..._a, display: G ? void 0 : "none" }, hidden: !G, "aria-label": "文本生成器", onKeyDown: (re) => re.stopPropagation(), children: /* @__PURE__ */ d.jsx(
            D4,
            {
              inline: !0,
              compact: !0,
              workspace: n.workspace,
              userId: a.me.id,
              project: n.id,
              node: b,
              nodeTitle: U.title,
              onActivityChange: (re) => V((F) => re ? F.includes(b) ? F : [...F, b] : F.includes(b) ? F.filter((_e) => _e !== b) : F),
              getContext: async () => ({ project: n.id, node: b, expected_revision: await s.flush(), writeback: !0 }),
              onApply: (re, F, _e, Be) => {
                const De = async () => {
                  const On = s.ref.current.document.nodes.find((Vi) => Vi.id === b && Vi.type === "text");
                  if (!On) throw new Error("文本节点已删除，未写入结果");
                  const Ea = Be?.expectedText ?? U.text;
                  if (On.text !== Ea && On.text !== F.content) throw new Error("节点文字已被修改，未覆盖。请基于当前文字重新生成。");
                  const ot = On.text, Fn = await s.flush();
                  if (s.ref.current.document.nodes.find((Vi) => Vi.id === b)?.text !== ot) throw new Error("节点文字已被修改，未覆盖。请基于当前文字重新生成。");
                  const Ci = JSON.stringify(s.ref.current), Vn = await og(n.workspace, "/api/chats/" + re + "/apply", { uid: Be?.uid || crypto.randomUUID(), message: F.id, project: n.id, expected_revision: Fn, mode: "replace", node: b, expected_text: ot });
                  s.acceptRemote(Vn, Ci);
                }, tt = k.current.then(De);
                return k.current = tt.catch(() => {
                }), tt;
              }
            }
          ) }, b);
        }),
        O === "assets" && /* @__PURE__ */ d.jsxs(
          Di,
          {
            title: "资产库",
            wide: !0,
            onClose: () => {
              Y(null), zn(/* @__PURE__ */ new Set());
            },
            children: [
              /* @__PURE__ */ d.jsxs("div", { className: "picker-filter", children: [
                /* @__PURE__ */ d.jsx("div", { children: ["all", "image", "video"].filter((b) => !j || b === "image").map((b) => /* @__PURE__ */ d.jsx(
                  "button",
                  {
                    className: vn === b ? "active" : "",
                    onClick: () => dn(b),
                    children: { all: "全部", image: "图片", video: "视频" }[b]
                  },
                  b
                )) }),
                /* @__PURE__ */ d.jsxs(
                  "button",
                  {
                    className: "secondary",
                    onClick: () => {
                      rn.current = j, hn.current?.click(), Y(null);
                    },
                    children: [
                      /* @__PURE__ */ d.jsx(lp, { size: 16 }),
                      "上传图片"
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ d.jsx("div", { className: "picker-grid", children: xa.filter((b) => vn === "all" || b.kind === vn).map((b) => /* @__PURE__ */ d.jsxs(
                "button",
                {
                  className: "picker-item " + (Lt.has(b.id) ? "selected" : ""),
                  onClick: () => zn((U) => {
                    const G = j ? /* @__PURE__ */ new Set() : new Set(U);
                    return U.has(b.id) ? G.delete(b.id) : G.add(b.id), G;
                  }),
                  children: [
                    b.kind === "image" ? /* @__PURE__ */ d.jsx("img", { src: Si(b.id), alt: b.title, loading: "lazy" }) : /* @__PURE__ */ d.jsx(
                      "video",
                      {
                        src: Si(b.id) + "#t=0.05",
                        preload: "metadata",
                        muted: !0
                      }
                    ),
                    /* @__PURE__ */ d.jsx("span", { children: b.title }),
                    Lt.has(b.id) && /* @__PURE__ */ d.jsx(pi, { className: "picked", size: 18 })
                  ]
                },
                b.id
              )) }),
              !xa.length && /* @__PURE__ */ d.jsx("p", { className: "empty", children: "暂无资产" }),
              /* @__PURE__ */ d.jsxs("div", { className: "dialog-actions", children: [
                /* @__PURE__ */ d.jsx("span", { children: Lt.size ? `已选 ${Lt.size} 项` : "" }),
                /* @__PURE__ */ d.jsx(
                  "button",
                  {
                    className: "primary",
                    disabled: !Lt.size,
                    onClick: xs,
                    children: j ? "替换内容" : "添加到画布"
                  }
                )
              ] })
            ]
          }
        ),
        O === "references" && K && /* @__PURE__ */ d.jsx(Di, { title: "引用画布节点", onClose: () => Y(null), children: /* @__PURE__ */ d.jsxs("div", { className: "source-list", children: [
          dr.map((b) => {
            const U = pf(
              s.value.document,
              b.id,
              K.id
            ), G = Oi(b, f).media;
            return /* @__PURE__ */ d.jsxs(
              "button",
              {
                disabled: !!U,
                title: U,
                onClick: () => {
                  _i({
                    source: b.id,
                    target: K.id,
                    sourceHandle: null,
                    targetHandle: null
                  }), Y(null);
                },
                children: [
                  G ? /* @__PURE__ */ d.jsx("img", { src: Si(G), alt: "" }) : yc.createElement(wc[b.type], { size: 22 }),
                  /* @__PURE__ */ d.jsxs("span", { children: [
                    /* @__PURE__ */ d.jsx("strong", { children: b.title }),
                    /* @__PURE__ */ d.jsx("small", { children: b.type === "text" ? b.text.slice(0, 60) : G ? "图片" : "尚未生成" })
                  ] }),
                  /* @__PURE__ */ d.jsx(La, { size: 16 })
                ]
              },
              b.id
            );
          }),
          !dr.length && /* @__PURE__ */ d.jsx("p", { className: "empty", children: "暂无可引用的文本或图片节点" })
        ] }) }),
        O === "search" && /* @__PURE__ */ d.jsxs(Di, { title: "搜索节点", onClose: () => Y(null), children: [
          /* @__PURE__ */ d.jsxs("div", { className: "list-search", children: [
            /* @__PURE__ */ d.jsx(np, { size: 17 }),
            /* @__PURE__ */ d.jsx(
              "input",
              {
                autoFocus: !0,
                placeholder: "搜索名称或文本",
                "aria-label": "搜索名称或文本",
                value: Zt,
                onChange: (b) => Tt(b.target.value)
              }
            )
          ] }),
          /* @__PURE__ */ d.jsx("div", { className: "source-list", children: s.value.document.nodes.filter(
            (b) => (b.title + " " + b.text + " " + b.prompt).toLowerCase().includes(Zt.toLowerCase())
          ).map((b) => /* @__PURE__ */ d.jsxs(
            "button",
            {
              onClick: () => {
                jn(b.id), yt([b.id]), Y(null);
              },
              children: [
                yc.createElement(wc[b.type], { size: 20 }),
                /* @__PURE__ */ d.jsxs("span", { children: [
                  /* @__PURE__ */ d.jsx("strong", { children: b.title }),
                  /* @__PURE__ */ d.jsx("small", { children: b.text || b.prompt || bc[b.type] })
                ] })
              ]
            },
            b.id
          )) })
        ] }),
        O === "history" && /* @__PURE__ */ d.jsx(Di, { title: "生成历史", onClose: () => Y(null), children: /* @__PURE__ */ d.jsxs("div", { className: "run-list", children: [
          f.filter((b) => b.kind !== "audio").map((b) => /* @__PURE__ */ d.jsxs(
            "button",
            {
              onClick: () => {
                s.value.document.nodes.some((U) => U.id === b.canvas_node) ? (jn(b.canvas_node), yt([b.canvas_node]), Y(null)) : Pe("该节点已移除，作品仍可在资产中查看");
              },
              children: [
                b.result ? b.kind === "image" ? /* @__PURE__ */ d.jsx("img", { src: Si(b.result), alt: "" }) : /* @__PURE__ */ d.jsx(
                  "video",
                  {
                    src: Si(b.result) + "#t=0.05",
                    preload: "metadata",
                    muted: !0
                  }
                ) : yc.createElement(b.kind === "image" ? xf : Jr, {
                  size: 22
                }),
                /* @__PURE__ */ d.jsxs("span", { children: [
                  /* @__PURE__ */ d.jsx("strong", { children: b.prompt.slice(0, 60) }),
                  /* @__PURE__ */ d.jsxs("small", { children: [
                    "#",
                    b.id,
                    " · ",
                    Nf[b.status],
                    " ·",
                    " ",
                    new Date(b.created * 1e3).toLocaleString()
                  ] })
                ] })
              ]
            },
            b.id
          )),
          !f.length && /* @__PURE__ */ d.jsx("p", { className: "empty", children: "暂无生成记录" })
        ] }) }),
        Ve && /* @__PURE__ */ d.jsx(Di, { title: "AI 分镜", wide: !0, onClose: () => $e(!1), children: /* @__PURE__ */ d.jsx(U4, { workspace: n.workspace, userId: r.me.id, project: n.id, onApply: async (b) => {
          await s.flush();
          const U = s.ref.current.document;
          if (U.nodes.length + b.length * 2 > 200 || U.edges.length + b.length > 600) throw new Error("画布容量不足，请先整理节点");
          const G = U.nodes.length ? Math.max(...U.nodes.map((F) => F.x + F.width)) + 120 : 0, re = b.map((F, _e) => ({ text: { ...us("text", G + _e * 400, 0, _e + 1), title: F.title + " · 文案", text: F.prompt }, video: { ...us("video", G + _e * 400, 330, _e + 1), title: F.title, narration_text: F.narration, params: { ...us("video", 0, 0, 1).params, model: "MiniMax H3", seconds: F.seconds } } }));
          s.change((F) => ({ ...F, document: { ...F.document, nodes: [...F.document.nodes, ...re.flatMap((_e) => [_e.text, _e.video])], edges: [...F.document.edges, ...re.map((_e) => ({ id: crypto.randomUUID(), source: _e.text.id, target: _e.video.id }))], shots: [...F.document.shots || [], ...re.map((_e) => _e.video.id)] } })), $e(!1), v([re[0].video.id]), requestAnimationFrame(() => yt(re.map((F) => F.video.id))), Pe("已加入分镜，可编辑后再生成");
        } }) }),
        Me && /* @__PURE__ */ d.jsx(Di, { title: "素材包", wide: !0, onClose: () => Ge(null), children: /* @__PURE__ */ d.jsx(
          q4,
          {
            workspace: n.workspace,
            userId: r.me.id,
            admin: r.me.role === "admin",
            selected: s.value.document.nodes.find((b) => b.id === Me)?.asset_packs || [],
            imageRefs: z.filter((b) => !!b),
            onImportImages: (b, U) => P(U, b),
            onImportPack: (b) => P(b),
            onRemovePack: (b) => {
              const U = s.ref.current.document.nodes.find((G) => G.id === Me);
              U && zt(U.id, { asset_packs: (U.asset_packs || []).filter((G) => G.id !== b) }), Ge(null);
            }
          }
        ) }),
        Mn && K && /* @__PURE__ */ d.jsxs(Di, { title: "生成两个候选", onClose: () => Et(!1), children: [
          /* @__PURE__ */ d.jsxs("p", { children: [
            "为“",
            K.title,
            "”生成 2 个候选，共 ",
            di,
            " 积分。各候选独立完成，失败或取消的候选会退回积分。"
          ] }),
          /* @__PURE__ */ d.jsxs("div", { className: "dialog-actions", children: [
            /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => Et(!1), children: "取消" }),
            /* @__PURE__ */ d.jsxs("button", { className: "primary", disabled: !or, onClick: () => {
              Bn();
            }, children: [
              "确认生成 · ",
              di
            ] })
          ] })
        ] }),
        Ne && /* @__PURE__ */ d.jsx(Di, { title: "镜头列表", wide: !0, onClose: () => ze(!1), children: /* @__PURE__ */ d.jsx(
          H4,
          {
            shots: tn,
            onMove: Ni,
            onExport: Xa,
            composition: /* @__PURE__ */ d.jsx($4, { project: n.id, getRevision: s.flush, ready: tn.length > 0 && !dl, waitingReason: dl }),
            renderNarration: (b) => {
              const U = s.value.document.nodes.find((re) => re.id === b.id), G = r.pricing.items.find((re) => re.key === "breeze-tts-2|standard")?.amount ?? null;
              return /* @__PURE__ */ d.jsx(
                B4,
                {
                  node: U,
                  runs: f,
                  cost: G,
                  unavailableReason: nn("breeze-tts-2") ? G === null ? "语音生成尚未定价" : r.credits.available < G ? "当前空间积分不足" : "" : "当前空间未开放语音模型",
                  onChange: (re) => zt(b.id, re),
                  onGenerate: async () => {
                    const re = await s.flush(), F = `fm-canvas-voice-${r.me.id}-${n.id}-${b.id}`;
                    let _e;
                    try {
                      _e = JSON.parse(localStorage.getItem(F) || "null");
                    } catch {
                    }
                    _e || (_e = { uid: crypto.randomUUID(), expected_revision: re, price_revision: r.pricing.revision }, localStorage.setItem(F, JSON.stringify(_e)));
                    try {
                      const Be = await ln(`/api/canvases/${n.id}/nodes/${b.id}/narration`, _e);
                      zt(b.id, { narration_pending: Be.id }), await s.flush(), localStorage.removeItem(F), await ga();
                    } catch (Be) {
                      throw Be instanceof Wr && Be.status < 500 && localStorage.removeItem(F), Be;
                    }
                  }
                }
              );
            },
            onRemove: (b) => Ia((U) => U.filter((G) => G !== b)),
            onSelect: (b) => {
              ze(!1), jn(b), yt([b]);
            }
          }
        ) }),
        $t && be && /* @__PURE__ */ d.jsxs(Di, { title: "首帧裁切预览", onClose: () => Qn(!1), children: [
          /* @__PURE__ */ d.jsxs("p", { children: [
            "MiniMax H3 会按 ",
            K?.params.ratio,
            " 居中裁切单张参考图，并将它用作首帧。"
          ] }),
          /* @__PURE__ */ d.jsx("div", { className: "crop-preview", children: /* @__PURE__ */ d.jsx("img", { src: Si(be), alt: "生成画幅中的首帧", style: { aspectRatio: fi } }) })
        ] }),
        Ln && Va.length > 1 && /* @__PURE__ */ d.jsx(Di, { title: `对比版本 · ${Ln.title}`, wide: !0, onClose: () => It(null), children: /* @__PURE__ */ d.jsx(
          L4,
          {
            runs: Va,
            adopted: Ln.active_job,
            onAdopt: (b) => zt(Ln.id, { active_job: b, use_media: !1 })
          }
        ) }),
        bt && /* @__PURE__ */ d.jsxs(Di, { title: "应用参考图到镜头", onClose: () => Nt(null), children: [
          /* @__PURE__ */ d.jsx("p", { children: "勾选需要共用这张图的镜头。修改连线会影响后续生成。" }),
          /* @__PURE__ */ d.jsxs("div", { className: "reference-targets", children: [
            /* @__PURE__ */ d.jsxs("label", { children: [
              /* @__PURE__ */ d.jsx(
                "input",
                {
                  type: "checkbox",
                  checked: St.length === tn.length && tn.length > 0,
                  onChange: (b) => ft(b.target.checked ? tn.map((U) => U.id) : [])
                }
              ),
              "全选镜头"
            ] }),
            tn.map((b, U) => /* @__PURE__ */ d.jsxs("label", { children: [
              /* @__PURE__ */ d.jsx("input", { type: "checkbox", checked: St.includes(b.id), onChange: (G) => {
                const re = G.target.checked;
                ft((F) => re ? [...F, b.id] : F.filter((_e) => _e !== b.id));
              } }),
              String(U + 1).padStart(2, "0"),
              " · ",
              b.title || "未命名镜头"
            ] }, b.id))
          ] }),
          Ke && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: Ke }),
          /* @__PURE__ */ d.jsx("div", { className: "dialog-actions", children: /* @__PURE__ */ d.jsx("button", { className: "primary", onClick: Un, children: "应用到所选镜头" }) })
        ] }),
        le && /* @__PURE__ */ d.jsxs(Di, { title: le.node.title, wide: !0, onClose: () => {
          fn || (Te(null), gn(""));
        }, children: [
          /* @__PURE__ */ d.jsx("div", { className: "media-preview", children: le.node.type === "video" ? /* @__PURE__ */ d.jsx(
            "video",
            {
              ref: Li,
              src: Si(le.media),
              controls: !0,
              autoPlay: !0,
              playsInline: !0
            }
          ) : /* @__PURE__ */ d.jsx(
            "img",
            {
              src: Si(le.media),
              alt: le.node.title
            }
          ) }),
          Bt && /* @__PURE__ */ d.jsx("p", { className: "error", role: "alert", children: Bt }),
          le.node.type === "video" && nn("MiniMax H3") && /* @__PURE__ */ d.jsx("p", { children: "暂停在想保留的画面，可提取为图片，或设为 MiniMax H3 下一镜头的首帧。" }),
          /* @__PURE__ */ d.jsxs("div", { className: "dialog-actions preview-actions", children: [
            le.node.type === "video" && /* @__PURE__ */ d.jsxs(d.Fragment, { children: [
              /* @__PURE__ */ d.jsx("button", { className: "secondary", disabled: fn, onClick: () => hl(le, !1), children: fn ? "正在提取…" : "提取当前帧" }),
              nn("MiniMax H3") && /* @__PURE__ */ d.jsx("button", { className: "primary", disabled: fn, onClick: () => hl(le, !0), children: "用作下一镜头首帧" })
            ] }),
            /* @__PURE__ */ d.jsxs(
              "a",
              {
                className: "secondary",
                href: Si(le.media) + "?download=true",
                download: !0,
                children: [
                  /* @__PURE__ */ d.jsx(Xs, { size: 16 }),
                  "下载"
                ]
              }
            )
          ] })
        ] }),
        Ce && /* @__PURE__ */ d.jsxs(Di, { title: "重新载入画布？", onClose: () => we(null), children: [
          /* @__PURE__ */ d.jsx("p", { children: "将载入团队最新版本。请先下载需要保留的本地修改。" }),
          /* @__PURE__ */ d.jsxs("div", { className: "dialog-actions", children: [
            /* @__PURE__ */ d.jsx("button", { className: "secondary", onClick: () => we(null), children: "取消" }),
            /* @__PURE__ */ d.jsx("button", { className: "primary", onClick: () => Ce(), children: "重新载入" })
          ] })
        ] })
      ]
    }
  );
}
function J4() {
  const [n, a] = A.useState(null), [s, r] = A.useState(null), [o, f] = A.useState(""), h = location.pathname.split("/")[2];
  return A.useEffect(() => {
    (async () => {
      const m = h ? await ln("/api/canvases/" + h) : null;
      m && yx(m.workspace);
      const v = await ln("/api/state");
      yx(v.workspace_id), a(v), r(m);
    })().catch((m) => {
      m.status === 401 ? location.replace("/studio") : f(m.message);
    });
  }, []), o ? /* @__PURE__ */ d.jsxs("main", { className: "canvas-error", children: [
    /* @__PURE__ */ d.jsx("h1", { children: "画布暂时无法打开" }),
    /* @__PURE__ */ d.jsx("p", { children: o }),
    /* @__PURE__ */ d.jsx("a", { href: sl("/canvas"), children: "返回画布列表" })
  ] }) : !n || h && !s ? /* @__PURE__ */ d.jsxs("div", { className: "canvas-loading", children: [
    /* @__PURE__ */ d.jsx("img", { src: "/static/mark.svg", alt: "" }),
    /* @__PURE__ */ d.jsx("strong", { children: "弗淼 AIGC" })
  ] }) : s ? /* @__PURE__ */ d.jsx(hw, { children: /* @__PURE__ */ d.jsx(P4, { project: s, studio: n }, s.id) }) : /* @__PURE__ */ d.jsx(Z4, { studio: n });
}
lE.createRoot(document.getElementById("canvas-root")).render(/* @__PURE__ */ d.jsx(J4, {}));
