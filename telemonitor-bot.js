const IS_CF_WORKER = false;
const BOT_TOKEN = process.env.BOT_TOKEN;
const HANDLER_MAP = {}

if (IS_CF_WORKER) {
    addEventListener('fetch', event => {
        event.respondWith(handleRequest(event.request))
    })
}


class KVClient {
    constructor(isCfWorker) {
        this.accountIdentifier = process.env.ACCOUNT_IDENTIFIER;
        this.namespaceIdentifier = process.env.NAMESPACE_IDENTIFIER;
        this.bearerKey = process.env.BEARER_KEY;
        this.isCfWorker = isCfWorker;
    }

    async get(key) {
        // GET accounts/:account_identifier/storage/kv/namespaces/:namespace_identifier/values/:key_name
        const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountIdentifier}/storage/kv/namespaces/${this.namespaceIdentifier}/values/${key}`,
            {
                'headers': {
                    'Authorization': `Bearer ${this.bearerKey}`,
                    'Content-Type': 'application/json'
                }
            });
        return resp.status === 200;
    }

    async put(key, value) {
        return fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountIdentifier}/storage/kv/namespaces/${this.namespaceIdentifier}/values/${key}?expiration_ttl=7776000`,
            {
                'headers': {
                    'Authorization': `Bearer ${this.bearerKey}`,
                    'Content-Type': 'application/json'

                },
                method: 'PUT',
                body: value
            })
    }

    async existsInDB(routeName, id) {
        if (!this.isCfWorker) {
            return !!await this.get(buildKey(routeName, id));
        }
        return !!await TELEMONITOR_DB.get(buildKey(routeName, id))
    }

    async putInStore(routeName, id) {
        if (!this.isCfWorker) {
            return this.put(buildKey(routeName, id), 'haha', {expirationTtl: 3 * 30 * 24 * 3600})
        }
        return await TELEMONITOR_DB.put(buildKey(routeName, id), 'haha', {expirationTtl: 3 * 30 * 24 * 3600})
    }
}

const asyncNegFilter = async (arr, predicate) => Promise.all(arr.map(predicate))
    .then((results) => arr.filter((_v, index) => !results[index]));

async function postItemList(routeName, chat_id, item_list) {
    // [{url: xxx, text: xxx}, {url: yyy, text: yyy}]
    const kvClient = new KVClient(IS_CF_WORKER);
    const exist_list = await asyncNegFilter(item_list, x => kvClient.existsInDB(routeName, x.url))
    // build msg.
    const msg = exist_list.map(x => `<a href="${x.url}">${x.text}</a>`).join('\n')
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?disable_web_page_preview=true&parse_mode=html&chat_id=${chat_id}&text=${encodeURIComponent(msg)}`;
    const res = await fetch(url);
    if (await res.status === 200) {
        await Promise.all(exist_list.map(x => kvClient.putInStore(routeName, x.url)));
    }

}

const hashCode = function (s) {
    return s.split("").reduce(function (a, b) {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a
    }, 0);
}

function buildKey(routeName, id) {
    return `/${routeName}/${hashCode(id)}`
}


class AttributeRewriter {
    constructor() {
        this.itemList = [];
    }

    async element(element) {
        const attribute = element.getAttribute('href')
        if (attribute) {
            this.itemList.push({id: attribute, text: 'fff'})
        }
    }
}

class RentHouse {
    constructor() {
        this.routeName = 'rent13';
        this.chatId = process.env.RENT_GROUP;
    }


    async handle(chatId) {
        // const resp = await fetch();
        const itemList = [];
        if (IS_CF_WORKER) {
            const rewriter = new AttributeRewriter();
            await new HTMLRewriter()
                .on('a', rewriter).transform(resp);
            console.log(rewriter.itemList);
        } else {
            const dom = await jsdom.JSDOM.fromURL('https://www.1point3acres.com/bbs/forum.php?mod=forumdisplay&fid=224&filter=author&orderby=dateline&sortid=319');
            const eleList = dom.window.document.getElementsByClassName('s xst');
            for (const ele of eleList) {
                itemList.push({url: ele.href, text: ele.innerHTML})
            }
        }
        await postItemList(this.routeName, chatId || this.chatId, itemList);
    }
}

/**
 * Respond to the request
 * @param {Request} request
 */
async function handleRequest(request) {
    init();
    await dispatchRequests(request.url);
    return new Response('hello world\n' + request.url, {status: 200})
}


function register(handler) {
    console.log(handler.routeName);
    HANDLER_MAP[handler.routeName] = handler;
}

function init() {
    register(new RentHouse());
}

async function dispatchRequests(url) {
    url = url.trimRight('/');
    const lastIndex = url.lastIndexOf('/');
    const routeName = url.substring(lastIndex + 1);
    const urlParams = new URLSearchParams(url.split('?')[1]);
    if (!HANDLER_MAP[routeName]) {
        return
    }
    await HANDLER_MAP[routeName].handle(urlParams.get('chat_id'))

}


if (!IS_CF_WORKER) {
    fetch = require('node-fetch');
    jsdom = require('jsdom');
    const http = require('http');
    const server = http.createServer();
    server.on('request', async (req, res) => {
        init();
        await dispatchRequests(req.url);
        res.writeHead(200);
        res.end('Hello, World!');
    })
    server.listen(+process.env.PORT || 8080);
}

module.exports = async (req, res) => {
    init();
    await dispatchRequests(req.url);
    res.writeHead(200);
    res.end('Hello, World!');
}
