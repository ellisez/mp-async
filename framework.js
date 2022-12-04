
function isPromise(object) {
  return object && Object.prototype.toString.call(object) === '[object Promise]';
}
//#region 微信api，提升易用性
const wxAPI = wxProxy();

function wxProxy(callback) {
  return new Proxy({}, {
    get(_, key) {
      return function() {
        const promise = wxPromisify(wx[key], ...arguments);
        if (callback) callback(promise);
        return promise;
      }
    }
  });
}

function wxPromisify(api, options) {
  if (typeof(options) === 'object') {
    return new Promise((resolve, reject) => {
      api({
        ...options,
        success(res) {
          resolve(res);
        },
        fail(err) {
          reject(err);
        }
      });
    });
  } else {
    if (arguments.length === 1) {
      return api.apply();
    } 
    const params = [];
    for (let i=1; i<arguments.length; i++) {
      params.push(arguments[i]);
    }
    return api.apply(this, params);
  }
}
//#endregion

//#region
/**
 * 严格顺序执行:
 * [同步] onLaunch -> onLoad -> onShow -> onReady ....
 * >>>>> [异步] onAsyncLaunch -> onAsyncLoad -> onAsyncShow -> onAsyncReady ...
 * >>>>>>  [安全执行] safeExecute -> afterExecute
 */
class AsyncFunction {
  caller;
  process;
  success;
  fail;
  complete;

  #promise;

  constructor(caller, process) {
    this.caller = caller;
    this.process = process;
  }

  then(success) {
    this.success = success;
    return this;
  }
  catch (fail) {
    this.fail = fail;
    return this;
  } finally(complete) {
    this.complete = complete;
    return this;
  }

  run() {
    if (this.#promise) {
      return this.#promise;
    }
    this.#promise = new Promise(this.process)
      .then(res => {
        if (this.success) {
          this.success.call(this.caller, res);
        }
      })
      .catch(err => {
        if (this.fail) {
          this.fail.call(this.caller, err);
        }
        return err;
      })
      .finally(() => {
        if (this.complete) {
          this.complete.call(this.caller);
        }
      });
    return this.#promise;
  }
}
class AsyncCallFunction {
  caller;
  callFunction;
  params;

  #promise;

  constructor(caller, callFunction, ...params) {
    this.caller = caller;
    this.callFunction = callFunction;
    this.params = params;
  }

  run() {
    if (this.#promise) {
      return this.#promise;
    }
    console.debug(
      `%c [并发]${this.callFunction.name}() is running `,
      'color:#ffa500;font-size:1.2em;'
    );
    this.#promise = this.callFunction.apply(this.caller, this.params);
    if (!isPromise(this.#promise)) {
      throw new TypeError('async must be return Promise')
    }
    return this.#promise.catch(err => err);
  }
}

class AsyncPromise {
  isRun = false;
  #promise;

  constructor(promise) {
    this.#promise = promise;
  }

  run() {
    if (this.isRun) {
      return this.#promise;
    }
    this.#promise.catch(err => err);
    this.isRun = true;
    return this.#promise;
  }
}

class AsyncExecutor {
  #thisArg;
  allAsyncPromise = [];
  
  fail;
  success;
  complete;

  #promise;

  constructor(thisArg) {
    this.thisArg = thisArg
  }

  addFunction(fun) {
    const asyncPromise = new AsyncFunction(this.thisArg, fun);
    this.allAsyncPromise.push(asyncPromise);
    return asyncPromise;
  }
  addAsync(asyncFun, ...params) {
    const asyncPromise = new AsyncCallFunction(this.thisArg, asyncFun, ...params);
    this.allAsyncPromise.push(asyncPromise);
    return asyncPromise;
  }
  addPromise(promise) {
    const asyncPromise = new AsyncPromise.call(this.thisArg, promise);
    this.allAsyncPromise.push(asyncPromise);
    return asyncPromise;
  }
  addWX() {
    const caller = this;
    return wxProxy(function (wxPromise) {
      caller.addPromise.call(caller.thisArg, wxPromise);
    });
  }

  clear() {
    this.allAsyncPromise = [];
  }

  run() {
    if (this.#promise) {
      return this.#promise;
    }
    const queue = this.allAsyncPromise.map(asyncPromise => {
      if (asyncPromise.constructor.name === 'Promise') {
        return asyncPromise;
      } else {
        return asyncPromise.run();
      }
    });
    this.#promise = new Promise((resolve, reject) => {
      Promise.all(queue)
        .then(array => {
          for (let i = 0; i < array.length; i++) {
            const done = array[i];
            if (done instanceof Error) {
              if (this.fail) {
                this.fail();
              }
              reject(done);
              return;
            }
          }
          if (this.success) {
            this.success(array);
          }
          resolve();
        })
    });
    return this.#promise;
  }
}

/**
 * 严格顺序执行: 
 * [同步] onLaunch -> onLoad -> onShow -> onReady ....
 * >>>>> [异步] onAsyncLaunch -> onAsyncLoad -> onAsyncShow -> onAsyncReady ...
 * >>>>>>  [安全执行] safeExecute -> afterExecute
 */
class AsyncManager {

  appLaunchMulitAsync = [];

  pageLoadedMulitAsync = [];

  pageShowMulitAsync = [];

  pageReadyMulitAsync = [];

  safeMultiAsyncExecutor = new AsyncExecutor();

  /**
   * 应用初始化 -> onAsyncLaunch时执行
   */
  launchFunction(fun) {
    const asyncPromise = new AsyncFunction(this, fun);
    ApplicationAsyncManager.appLaunchMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  launchAsync(asyncFun, ...params) {
    const asyncPromise = new AsyncCallFunction(this, asyncFun, ...params);
    ApplicationAsyncManager.appLaunchMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  launchPromise(promise) {
    const asyncPromise = new AsyncPromise.call(this, promise);
    ApplicationAsyncManager.appLaunchMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  launchWX() {
    const that = this;
    return wxProxy(function (wxPromise) {
      ApplicationAsyncManager.launchPromise.call(that, wxPromise);
    });
  }

  /**
   * 页面初始化 -> onAsyncLoad时执行
   */
  loadFunction(fun) {
    const asyncPromise = new AsyncFunction(this, fun);
    ApplicationAsyncManager.pageLoadedMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  loadAsync(asyncFun, ...params) {
    const asyncPromise = new AsyncCallFunction(this, asyncFun, ...params);
    ApplicationAsyncManager.pageLoadedMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  loadPromise(promise) {
    const asyncPromise = new AsyncPromise.call(this, promise);
    ApplicationAsyncManager.pageLoadedMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  loadWX() {
    const that = this;
    return wxProxy(function (wxPromise) {
      ApplicationAsyncManager.loadPromise.call(that, wxPromise);;
    });
  }

  /**
   * 页面显示 -> onAsyncShow时执行
   */
  showFunction(fun) {
    const caller = this;
    if (this.isPageAsyncReady) {
      /// 已安全-立刻执行
      return new AsyncFunction(caller, fun).run();
    }
    const asyncPromise = new AsyncFunction(this, fun);
    ApplicationAsyncManager.pageShowMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  showAsync(asyncFun, ...params) {
    const caller = this;
    if (this.isPageAsyncReady) {
      /// 已安全-立刻执行
      return new AsyncCallFunction(caller, asyncFun, ...params).run();
    }
    const asyncPromise = new AsyncCallFunction(this, asyncFun, ...params);
    ApplicationAsyncManager.pageShowMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  showPromise(promise) {
    const caller = this;
    if (this.isPageAsyncReady) {
      /// 已安全-立刻执行
      return promise.then(() => {});
    }
    const asyncPromise = new AsyncPromise.call(this, promise);
    ApplicationAsyncManager.pageShowMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  showWX() {
    const that = this;
    return wxProxy(function (wxPromise) {
      ApplicationAsyncManager.showPromise.call(that, wxPromise);
    });
  }

  /**
   * 页面渲染 -> onAsyncReady时执行
   */
  readyFunction(fun) {
    const asyncPromise = new AsyncFunction(this, fun);
    ApplicationAsyncManager.pageReadyMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  readyAsync(asyncFun, ...params) {
    const asyncPromise = new AsyncCallFunction(this, asyncFun, ...params);
    ApplicationAsyncManager.pageReadyMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  readyPromise(promise) {
    const asyncPromise = new AsyncPromise.call(this, promise);
    ApplicationAsyncManager.pageReadyMulitAsync.push(asyncPromise);
    return asyncPromise;
  }
  readyWX() {
    const that = this;
    return wxProxy(function (wxPromise) {
      ApplicationAsyncManager.readyPromise.call(that, wxPromise);
    });
  }

  /**
   * 页面加载完成后执行 -> afterAsyncShow时执行
   */
  safeFunction(fun) {
    if (this.isPageAsyncReady) {
      /// 已安全-立刻执行
      return new AsyncFunction(this, fun).run();
    }
    const asyncPromise = new AsyncFunction(this, fun);
    ApplicationAsyncManager.safeMultiAsyncExecutor.allAsyncPromise.push(asyncPromise);
    return asyncPromise;
  }
  safeAsync(asyncFun, ...params) {
    if (this.isPageAsyncShow) {
      /// 已安全-立刻执行
      return new AsyncCallFunction(this, asyncFun, ...params).run();
    }
    const asyncPromise = new AsyncCallFunction(this, asyncFun, ...params);
    ApplicationAsyncManager.safeMultiAsyncExecutor.allAsyncPromise.push(asyncPromise);
    return asyncPromise;
  }
  safePromise(promise) {
    if (this.isPageAsyncShow) {
      /// 已安全-立刻执行
      return promise.then(() => {});
    }
    ApplicationAsyncManager.safeMultiAsyncExecutor.allAsyncPromise.push(promise);
    return asyncPromise;
  }
  safeWX() {
    const that = this;
    return wxProxy(function (wxPromise) {
      ApplicationAsyncManager.safePromise.call(that, wxPromise);
    });
  }

  onLaunch(app) {
    app.isAppLaunched = false;
    app.isAppAsyncLaunched = false;
  }

  /**
   * 应用启动-开启异步执行
   */
  async onAsyncLaunch(app) {
    if (app.launchAsyncExecutor) {
      await app.launchAsyncExecutor.run();
    }
  }

  onPageLoad(component) {
    component.isPageLoaded = false;
    component.isPageAsyncLoaded = false;
  }

  async onPageAsyncLoad(component) {
    const app = getApp();
    await this.onAsyncLaunch(app);
    if (component.loadAsyncExecutor) {
      await component.loadAsyncExecutor.run();
    }
  }

  onPageShow(component) {
    component.isPageShow = false;
    component.isPageAsyncShow = false;
  }

  async onPageAsyncShow(component) {
      await this.onPageAsyncLoad(component);
      if (component.showAsyncExecutor) {
        await component.showAsyncExecutor.run();
      }
  }

  onPageReady(component) {
    component.isPageAsyncReady = false;
    component.isPageReady = false;
  }

  async onPageAsyncReady(component) {
    await this.onPageAsyncShow(component);
    
    if (component.readyAsyncExecutor) {
      await component.readyAsyncExecutor.run();
    }

    wx.nextTick(async () => {
      try {
        await this.safeMultiAsyncExecutor.run();
      } finally {
        this.safeMultiAsyncExecutor = new AsyncExecutor();
      }
    });
  }

  createAsyncExecutor(thisArg) {
    const asyncExecutor = new AsyncExecutor(thisArg);
    (async () => {
      try {
        await this.appLaunchMultiAsyncExecutor.run();
        await this.pageLoadedMultiAsyncExecutor.run();
        await this.pageShowMulitAsyncExecutor.run();
        await this.pageReadyMultiAsyncExecutor.run();
      } catch(e) {
        return;
      }
      wx.nextTick(async () => {
        try {
          await asyncExecutor.run();
        } finally {
          asyncExecutor.clear();
        }
      });
    })();
    return asyncExecutor;
  }
}

const ApplicationAsyncManager = new AsyncManager();

/**
 * 支持异步的App, 用于编排页面启动过程中的异步执行顺序
 * @param {*} object 
 */
function AsyncApp(object) {
  App({
    ...object,
    launchFunction: ApplicationAsyncManager.launchFunction,
    launchAsync: ApplicationAsyncManager.launchAsync,
    launchPromise: ApplicationAsyncManager.launchPromise,
    launchWX: ApplicationAsyncManager.launchWX,

    loadFunction: ApplicationAsyncManager.loadFunction,
    loadAsync: ApplicationAsyncManager.loadAsync,
    loadPromise: ApplicationAsyncManager.loadPromise,
    loadWX: ApplicationAsyncManager.loadWX,

    readyFunction: ApplicationAsyncManager.readyFunction,
    readyAsync: ApplicationAsyncManager.readyAsync,
    readyPromise: ApplicationAsyncManager.readyPromise,
    readyWX: ApplicationAsyncManager.readyWX,

    showFunction: ApplicationAsyncManager.showFunction,
    showAsync: ApplicationAsyncManager.showAsync,
    showPromise: ApplicationAsyncManager.showPromise,
    showWX: ApplicationAsyncManager.showWX,

    safeFunction: ApplicationAsyncManager.safeFunction,
    safeAsync: ApplicationAsyncManager.safeAsync,
    safePromise: ApplicationAsyncManager.safePromise,
    safeWX: ApplicationAsyncManager.safeWX,

    createAsyncExecutor: ApplicationAsyncManager.createAsyncExecutor,
    
    onLaunch(options) {
      ApplicationAsyncManager.onLaunch(this);

      console.debug(
        '%c [同步]onLaunch开始了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        'App'
      );
      if (object.onLaunch) {
        object.onLaunch.call(this, options);
      }
      console.debug(
        '%c [同步]onLaunch结束了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        'App'
      );

      /// 并发app启动请求
      this.launchAsyncExecutor = new AsyncExecutor(this);
      const that = this;
      this.launchAsyncExecutor.success = () => {
        console.debug(
          '%c [异步]onAsyncLaunch结束了 ', 
          'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
          'App',
          that.launchAsyncExecutor.allAsyncPromise.length,
        );
        that.isAppAsyncLaunched = true;
      }
      this.launchAsyncExecutor.fail = () => {
        console.debug(
          '%c [异步]onAsyncLaunch被中止 存在异步任务错误 ', 
          'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
          'App', 
        );
      }
      this.launchAsyncExecutor.complete = () => {
        ApplicationAsyncManager.appLaunchMulitAsync.length = 0;
      }

      if (object.onAsyncLaunch) {
        this.launchAsync(
          object.onAsyncLaunch.bind(this), 
          options
        );
      }
      this.launchAsyncExecutor.allAsyncPromise.push(
        ...ApplicationAsyncManager.appLaunchMulitAsync
      );
      ApplicationAsyncManager.onAsyncLaunch(this);
    }

  })
}

/**
 * 支持异步的Page, 异步操作会等待异步AsyncApp所有异步完成后才开始执行
 * @param {*} object 
 */
function AsyncPage(object) {
  Page({
    ...object,
    loadFunction: ApplicationAsyncManager.loadFunction,
    loadAsync: ApplicationAsyncManager.loadAsync,
    loadPromise: ApplicationAsyncManager.loadPromise,
    loadWX: ApplicationAsyncManager.loadWX,

    readyFunction: ApplicationAsyncManager.readyFunction,
    readyAsync: ApplicationAsyncManager.readyAsync,
    readyPromise: ApplicationAsyncManager.readyPromise,
    readyWX: ApplicationAsyncManager.readyWX,

    showFunction: ApplicationAsyncManager.showFunction,
    showAsync: ApplicationAsyncManager.showAsync,
    showPromise: ApplicationAsyncManager.showPromise,
    showWX: ApplicationAsyncManager.showWX,

    safeFunction: ApplicationAsyncManager.safeFunction,
    safeAsync: ApplicationAsyncManager.safeAsync,
    safePromise: ApplicationAsyncManager.safePromise,
    safeWX: ApplicationAsyncManager.safeWX,

    createAsyncExecutor: ApplicationAsyncManager.createAsyncExecutor,

    onLoad(options) {
      ApplicationAsyncManager.onPageLoad(this);

      console.debug(
        '%c [同步]onLoad开始了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        this.is
      );
      if (object.onLoad) {
        object.onLoad.call(this, options);
      }
      console.debug(
        '%c [同步]onLoad结束了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        this.is
      );
      this.isPageLoaded = true;
      
      /// 并发页面加载请求
      this.loadAsyncExecutor = new AsyncExecutor(this);
      const that = this;
      this.loadAsyncExecutor.success = () => {
        console.debug(
          '%c [异步]onAsyncLoad结束了 ', 
          'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is,
          that.loadAsyncExecutor.allAsyncPromise.length,
        );
        that.isPageAsyncLoaded = true;
      }
      this.loadAsyncExecutor.fail = () => {
        console.debug(
          '%c [异步]onAsyncLoad被中止 存在异步任务错误 ',
          'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is, 
        );
      }
      this.loadAsyncExecutor.complete = () => {
        ApplicationAsyncManager.pageLoadedMulitAsync.length = 0;
      }
      ////
      if (object.onAsyncLoad) {
        this.loadAsyncExecutor.addAsync(
          object.onAsyncLoad.bind(this), 
          options
        );
      }
      this.loadAsyncExecutor.allAsyncPromise.push(
        ...ApplicationAsyncManager.pageLoadedMulitAsync
      );
      ApplicationAsyncManager.onPageAsyncLoad(this);
      
    },
    onShow(options) {
      ApplicationAsyncManager.onPageShow(this);

      console.debug(
        '%c [同步]onShow开始了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        this.is
      );
      if (object.onShow) {
        object.onShow.call(this, options);
      }
      console.debug(
        '%c [同步]onShow结束了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        this.is
      );
      this.isPageShow = true;

      /// 并发渲染异步后请求
      this.showAsyncExecutor = new AsyncExecutor(this);
      const that = this;
      this.showAsyncExecutor.success = () => {
        console.debug(
          '%c [异步]onAsyncShow结束了 ', 
          'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is,
          that.showAsyncExecutor.allAsyncPromise.length,
        );
        that.isPageAsyncShow = true;
      }
      this.showAsyncExecutor.fail = () => {
        console.debug(
          '%c [异步]onAsyncShow被中止 存在异步任务错误 ',
          'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is
        );
      }
      this.showAsyncExecutor.complete = () => {
        ApplicationAsyncManager.pageShowMulitAsync.length = 0;
      }

      if (object.onAsyncShow) {
        this.showAsyncExecutor.addAsync(
          object.onAsyncShow.bind(this), 
          options
        );
      }
      this.showAsyncExecutor.allAsyncPromise.push(
        ...ApplicationAsyncManager.pageShowMulitAsync
      );
      ApplicationAsyncManager.onPageAsyncShow(this);
    },
    onReady(options) {
      ApplicationAsyncManager.onPageReady(this);

      console.debug(
        '%c [同步]onReady开始了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        this.is
      );
      if (object.onReady) {
        object.onReady.call(this, options);
      }
      console.debug(
        '%c [同步]onReady结束了 ', 
        'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
        this.is
      );
      this.isPageReady = true;

      /// 并发渲染异步请求
      this.readyAsyncExecutor = new AsyncExecutor(this);
      const that = this;
      this.readyAsyncExecutor.success = () => {
        console.debug(
          '%c [异步]onAsyncReady结束了 ', 
          'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is,
          that.readyAsyncExecutor.allAsyncPromise.length,
        );
        this.isPageAsyncReady = true;
        console.debug(
          '%c [异步]页面初加载成功 ', 
          'background:#008000;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is,
        );
      }
      this.readyAsyncExecutor.fail = () => {
        console.debug(
          '%c [异步]onAsyncReady被中止 存在异步任务错误',
          'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is
        );
        console.debug(
          '%c [异步]页面初加载失败 ', 
          'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
          that.is,
        );
      }
      this.readyAsyncExecutor.complete = () => {
        ApplicationAsyncManager.pageReadyMulitAsync.length = 0;
      }

      if (object.onAsyncReady) {
        this.readyAsyncExecutor.addAsync(
          object.onAsyncReady.bind(this), 
          options, 
        );
      }
      this.readyAsyncExecutor.allAsyncPromise.push(
        ...ApplicationAsyncManager.pageReadyMulitAsync
      );
      ApplicationAsyncManager.onPageAsyncReady(this);
    },
  });
}

function AsyncComponent(object) {
  Component({
    ...object,
    methods: {
      ...object.methods,
      launchFunction: ApplicationAsyncManager.launchFunction,
      launchAsync: ApplicationAsyncManager.launchAsync,
      launchPromise: ApplicationAsyncManager.launchPromise,
      launchWX: ApplicationAsyncManager.launchWX,

      loadFunction: ApplicationAsyncManager.loadFunction,
      loadAsync: ApplicationAsyncManager.loadAsync,
      loadPromise: ApplicationAsyncManager.loadPromise,
      loadWX: ApplicationAsyncManager.loadWX,

      readyFunction: ApplicationAsyncManager.readyFunction,
      readyAsync: ApplicationAsyncManager.readyAsync,
      readyPromise: ApplicationAsyncManager.readyPromise,
      readyWX: ApplicationAsyncManager.readyWX,

      showFunction: ApplicationAsyncManager.showFunction,
      showAsync: ApplicationAsyncManager.showAsync,
      showPromise: ApplicationAsyncManager.showPromise,
      showWX: ApplicationAsyncManager.showWX,

      safeFunction: ApplicationAsyncManager.safeFunction,
      safeAsync: ApplicationAsyncManager.safeAsync,
      safePromise: ApplicationAsyncManager.safePromise,
      safeWX: ApplicationAsyncManager.safeWX,

      createAsyncExecutor: ApplicationAsyncManager.createAsyncExecutor,

      onLoad(options) {
        ApplicationAsyncManager.onPageLoad(this);

        console.debug(
          '%c [同步]onLoad开始了 ', 
          'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
          this.is
        );
        if (object.methods?.onLoad) {
          object.methods?.onLoad.call(this, options);
        }
        console.debug(
          '%c [同步]onLoad结束了 ', 
          'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
          this.is
        );
        this.isPageLoaded = true;
        
        /// 并发页面加载请求
        this.loadAsyncExecutor = new AsyncExecutor(this);
        const that = this;
        this.loadAsyncExecutor.success = () => {
          console.debug(
            '%c [异步]onAsyncLoad结束了 ', 
            'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is,
            that.loadAsyncExecutor.allAsyncPromise.length,
          );
          that.isPageAsyncLoaded = true;
        }
        this.loadAsyncExecutor.fail = () => {
          console.debug(
            '%c [异步]onAsyncLoad被中止 存在异步任务错误 ',
            'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is, 
          );
        }
        this.loadAsyncExecutor.complete = () => {
          ApplicationAsyncManager.pageLoadedMulitAsync.length = 0;
        }
        ////
        if (object.methods?.onAsyncLoad) {
          this.loadAsyncExecutor.addAsync(
            object.methods?.onAsyncLoad.bind(this), 
            options
          );
        }
        this.loadAsyncExecutor.allAsyncPromise.push(
          ...ApplicationAsyncManager.pageLoadedMulitAsync
        );
        ApplicationAsyncManager.onPageAsyncLoad(this);
        
      },
      onShow(options) {
        ApplicationAsyncManager.onPageShow(this);

        console.debug(
          '%c [同步]onShow开始了 ', 
          'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
          this.is
        );
        if (object.methods?.onShow) {
          object.methods?.onShow.call(this, options);
        }
        console.debug(
          '%c [同步]onShow结束了 ', 
          'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
          this.is
        );
        this.isPageShow = true;

        /// 并发渲染异步后请求
        this.showAsyncExecutor = new AsyncExecutor(this);
        const that = this;
        this.showAsyncExecutor.success = () => {
          console.debug(
            '%c [异步]onAsyncShow结束了 ', 
            'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is,
            that.showAsyncExecutor.allAsyncPromise.length,
          );
          that.isPageAsyncShow = true;
        }
        this.showAsyncExecutor.fail = () => {
          console.debug(
            '%c [异步]onAsyncShow被中止 存在异步任务错误 ',
            'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is
          );
        }
        this.showAsyncExecutor.complete = () => {
          ApplicationAsyncManager.pageShowMulitAsync.length = 0;
        }

        if (object.methods?.onAsyncShow) {
          this.showAsyncExecutor.addAsync(
            object.methods?.onAsyncShow.bind(this), 
            options
          );
        }
        this.showAsyncExecutor.allAsyncPromise.push(
          ...ApplicationAsyncManager.pageShowMulitAsync
        );
        ApplicationAsyncManager.onPageAsyncShow(this);
      },
      onReady(options) {
        ApplicationAsyncManager.onPageReady(this);

        console.debug(
          '%c [同步]onReady开始了 ', 
          'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
          this.is
        );
        if (object.methods?.onReady) {
          object.methods?.onReady.call(this, options);
        }
        console.debug(
          '%c [同步]onReady结束了 ', 
          'background:#696969;color:#fff;border-radius: 3px;font-size:1.3em;',
          this.is
        );
        this.isPageReady = true;

        /// 并发渲染异步请求
        this.readyAsyncExecutor = new AsyncExecutor(this);
        const that = this;
        this.readyAsyncExecutor.success = () => {
          console.debug(
            '%c [异步]onAsyncReady结束了 ', 
            'background:#ffa500;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is,
            that.readyAsyncExecutor.allAsyncPromise.length,
          );
          this.isPageAsyncReady = true;
          console.debug(
            '%c [异步]页面初加载成功 ', 
            'background:#008000;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is,
          );
        }
        this.readyAsyncExecutor.fail = () => {
          console.debug(
            '%c [异步]onAsyncReady被中止 存在异步任务错误',
            'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is
          );
          console.debug(
            '%c [异步]页面初加载失败 ', 
            'background:#8b0000;color:#fff;border-radius: 3px;font-size:1.3em;',
            that.is,
          );
        }
        this.readyAsyncExecutor.complete = () => {
          ApplicationAsyncManager.pageReadyMulitAsync.length = 0;
        }

        if (object.methods?.onAsyncReady) {
          this.readyAsyncExecutor.addAsync(
            object.methods?.onAsyncReady.bind(this), 
            options, 
          );
        }
        this.readyAsyncExecutor.allAsyncPromise.push(
          ...ApplicationAsyncManager.pageReadyMulitAsync
        );
        ApplicationAsyncManager.onPageAsyncReady(this);
      },
    }
  });
}
//#endregion

module.exports = {
  AsyncApp,
  AsyncPage,
  AsyncComponent,
  ApplicationAsyncManager,

  createAsyncExecutor: ApplicationAsyncManager.createAsyncExecutor,

  launchFunction: ApplicationAsyncManager.launchFunction,
  launchAsync: ApplicationAsyncManager.launchAsync,
  launchPromise: ApplicationAsyncManager.launchPromise,
  launchWX: ApplicationAsyncManager.launchWX,

  loadFunction: ApplicationAsyncManager.loadFunction,
  loadAsync: ApplicationAsyncManager.loadAsync,
  loadPromise: ApplicationAsyncManager.loadPromise,
  loadWX: ApplicationAsyncManager.loadWX,

  readyFunction: ApplicationAsyncManager.readyFunction,
  readyAsync: ApplicationAsyncManager.readyAsync,
  readyPromise: ApplicationAsyncManager.readyPromise,
  readyWX: ApplicationAsyncManager.readyWX,

  showFunction: ApplicationAsyncManager.showFunction,
  showAsync: ApplicationAsyncManager.showAsync,
  showPromise: ApplicationAsyncManager.showPromise,
  showWX: ApplicationAsyncManager.showWX,

  safeFunction: ApplicationAsyncManager.safeFunction,
  safeAsync: ApplicationAsyncManager.safeAsync,
  safePromise: ApplicationAsyncManager.safePromise,
  safeWX: ApplicationAsyncManager.safeWX,

  wxAPI,
  wxPromisify,
}