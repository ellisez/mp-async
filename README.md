# mp-async
Asynchronous Orchestration Framework of WeChat MiniProgram. 
onLaunch(), OnLoad(), onShow() and onReady() executes asynchronous functions in sequence

##一、 框架介绍：
小程序在开发过程中，无论使用wx本身的api，还是调用后端http接口，都存在大量的异步操作，如果异步执行没有任何编排将会产生灾难性的后果，比如过于依赖于网络的先调用后到达；

以下几个方案，并不理想：
1. 全局注册事件会增加编程复杂度，而且在替换事件处理函数的瞬间也有可能被后调用替换到，造成失败；
2. 基于http主要请求的loading遮盖层开关，只能拦截主要http请求，且非http类异步也无法满足；
3. http并发401重登录，在极端网络下，会产生多次登录，而且仅仅是为了解决登录先后，对于其他异步十分无力；
4. 多发loading遮盖层，基于各个请求，通过定时器轮询来续命，是基于各个请求把loading遮盖层续上命的假设，但在极端情况下，网络时间足够长，顺序请求出现并发乱序返回，”没续上命“，就会出现不可预知的loading隐藏后又出现“霹雳舞”；

基于以上思考，迫切需要一个稳定的且易用性高的异步编排框架，简单的说就是建立一套按照严格执行顺序的运行的异步框架，具体如下：

小程序标准生命周期如下：onLaunch -> onLoad -> onShow -> onReady [ -> onShow -> onHide ->onUnLoad] 
框架延申出四个异步生命周期：onAsyncLaunch -> onAsyncLoad -> onAsyncShow -> onAsyncReady
注册在此四个生命周期内的异步代码，均会全部执行完毕后，才会到下一生命周期；

如下图：
我们可以清晰的看到，每个阶段的异步代码，被严格按照生命周期顺序执行；结合下图，我们惊喜的发现在使用页面的onAsyncLoad钩子时，onAsyncLaunch已经完成：

###日志格式为：    [同步|异步|并发]<日志内容> <主体范围> <参数>

[异步]onAsyncLoad结束了 pages/index/index 1
表示生命钩子onAsyncLoad运行完毕，页面是pages/index/index，期间并发了1个异步函数

[并发]bound onAsyncShow() is running
表示在生命钩子范围内某个异步函数，开始并发了

下面的章节我们将具体讲述如何使用异步编排框架：




##二、 安装框架
###首先需要引入类库：
###第二步，将App替换为AsyncPage
###第三步，声明钩子函数，这里提供了与标准生命周期一致的4种钩子函数，命名上只是多了个Async；

onAsyncLaunch / onAsyncLoad / onAsyncShow / onAsyncReady
注意这些钩子函数必须声明为async，或者return Promise对象，否则无法产生效用（也不会报错）；

框架除了提供上述AsyncApp的安装，还有AsyncPage，AsyncComponent等，使用方法类似，这里不做展开；

##三、 异步生命周期
如安装篇，我们讲到框架提供了，类似小程序自带的生命周期函数，开发者可自行去声明与实现，那么这些钩子所对应的含义是什么呢？这里做详细的说明。

###onAsyncLaunch: 同步函数onLaunch完成后可将异步操作交由onAsyncLaunch完成，onAsyncLaunch会使异步代码并发执行，仅当所有并发完成时，此生命才会结束，类似一个promise.all();
###onAsyncLoad: 同步函数onLoad的异步执行，与上述做法类似，仅当所有异步并发都完成时，此生命周期才会结束；

###onAsyncShow：对应的时同步函数onShow的异步并发执行，同样是所有并发完成后，才结束；

###onAsyncReady: 对应onReady，这里不赘述；



##四、 兼容性
为了兼容各种场景，异步框架不做强制安装，如果业务中不需要异步编排（不需要等待登录状态），仍可以使用原本的App, Page, Component，即使安装了框架，原来的标准同步函数，仍可正常使用（onLaunch / onLoad / onShow / onReady）；
但如果同时使用，同步函数与异步函数钩子，容易引起不必要的顺序混乱；以下是同步函数与异步函数在各种情况下的执行顺序，仅作参考：

###1. 初次启动app：[同步]onLaunch -> [同步]onLoad -> [同步]onShow -> [同步]onReady -> [异步]onAsyncLaunch -> [异步]onAsyncLoad -> [异步]onAsyncShow -> [异步]onAsyncReady

###2. app启动完成, 但切换的页面是初加载:  [同步]onLoad -> [同步]onShow ->  [异步]onAsyncLoad -> [异步]onAsyncShow -> [同步]onReady ->  [异步]onAsyncReady

###3. app已启动,切换的页面也加载过: [同步]onShow -> [异步]onAsyncShow

##五、 高级用法
框架除了提供异步的生命钩子，还提供了自定义编排方式，主要考虑到在一些特定场合，离开了AsyncApp，AsyncPage，AsyncComponent的操作主体，仍可以预先对钩子进行植入，特别是custom-tab-bar，我们期望值是等到页面加载后，通过页面的路径判断，当前选中的tabbar是谁，但custom-tab-bar声明时页面还没完成加载，此时就非常需要预设一个加载后执行的回调。

框架提供了以下两种方案：
###a. 使用指定生命范围的回调函数：

如图：
可以调用一系列xxxAsync()预先往对应的编排加入并发，xxx就是标准生命周期，如launch，load，show，ready；

提供4种编入方式:
####1. xxxFunction传入的是function(resolve, reject){}, 它最大程度的替代new Promise()写法；
####2. xxxAsync传入一个async函数，也就是return Promise类型的函数；
####3. xxxPromise传入一个创建好的Promise，这里如果Prmoise.then了，就不会按照钩子所在的顺序去执行，而是立刻执行，但所在的生命周期会一直等待此Promise完结如果它立刻执行还比其他并发要慢的情况下；
####4. xxxWX指的是调用微信api的并发也写入到指定生命钩子，后面章节会介绍；
####5. safeXXX这类调用表示所有生命周期的所有并发结束后，调用它非常安全，常用于loading的关闭（如果页面所有情况都需要打开loading的话）；

###b.  创建异步执行器
如图：createAsyncExecutor用于页面已经完成加载后，自定义生命周期

异步执行器可以实现一个类似，某个生命周期并发所有都完成后，才会结束的编程；
范例如下：


addXXX共4种：addFunction | addAsync | addPromise | addWX 

####createAsyncExecutor类似于Prmose.all()，但优化了非常多的细节，首先是被加入到执行器的并发可自由的then，catch，使得不用遵守Promise.all()在结果上统一处理，而是分散给各个执行器，其次异步执行器可以较为完美的融入框架的其他异步生命钩子；
