const volume = document.getElementById('volume')
const bass = document.getElementById('bass')
const mid = document.getElementById('mid')
const treble = document.getElementById('treble')
const visualizer = document.getElementById('visualizer')


const distortion_filter = document.getElementById('distortion_filter')


const reverb_attack = document.getElementById('reverb_attack_filter')
const reverb_depth = document.getElementById('reverb_depth_filter')

const crunch_filter = document.getElementById('crunch_filter')

const delay_filter = document.getElementById('delay_filter')


const context = new AudioContext()
const analyserNode = new AnalyserNode(context, { fftSize: 256 })
const gainNode = new GainNode(context, { gain: volume.value })
const bassEQ = new BiquadFilterNode(context, {
    type: 'lowshelf',
    frequency: 500,
    gain: bass.value
})
const midEQ = new BiquadFilterNode(context, {
    type: 'peaking',
    Q: Math.SQRT1_2,
    frequency: 1500,
    gain: mid.value
})
const trebleEQ = new BiquadFilterNode(context, {
    type: 'highshelf',
    frequency: 3000,
    gain: treble.value
})


var dist = context.createWaveShaper()
dist.curve = makeDistortionCurve(10)

var dist1 = context.createWaveShaper()
dist1.curve = makeDistortionCurve(40)

// var delay = context.createDelay()
// delay.delayTime.value = 0.05


setupEventListeners()
setupContext()
resize()
drawVisualizer()

function makeDistortionCurve(amount) {
    var k = amount,
        n_samples = typeof sampleRate === 'number' ? sampleRate : 44100,
        curve = new Float32Array(n_samples),
        deg = Math.PI / 180,
        i = 0,
        x;
    for (; i < n_samples; ++i) {
        x = i * 2 / n_samples - 1;
        curve[i] = (3 + k) * Math.atan(Math.sinh(x * 0.25) * 5) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

class Effect {

    constructor(context) {
        this.name = "effect";
        this.context = context;
        this.input = this.context.createGain();
        this.effect = null;
        this.bypassed = false;
        this.output = this.context.createGain();
        this.setup();
        this.wireUp();
    }

    setup() {
        this.effect = this.context.createGain();
    }

    wireUp() {
        this.input.connect(this.effect);
        this.effect.connect(this.output);
    }

    connect(destination) {
        this.output.connect(destination);
    }

}

class Sample {
    constructor(context) {
        this.context = context;
        this.buffer = this.context.createBufferSource();
        this.buffer.start();
        this.sampleBuffer = null
        this.rawBuffer = null;
        this.loaded = false;
        this.output = this.context.createGain();
        this.output.gain.value = 0.1;
    }

    play() {
        if (this.loaded) {
            this.buffer = this.context.createBufferSource();
            this.buffer.buffer = this.sampleBuffer;
            this.buffer.connect(this.output);
            this.buffer.start(this.context.currentTime);
        }
    }

    connect(input) {
        this.output.connect(input);
    }

    load(path) {
        this.loaded = false;
        return fetch(path)
            .then((response) => response.arrayBuffer())
            .then((myBlob) => {
                return new Promise((resolve, reject) => {
                    this.context.decodeAudioData(myBlob, resolve, reject);
                })
            })
            .then((buffer) => {
                this.sampleBuffer = buffer;
                this.loaded = true;
                return this;
            })
    }
}


class AmpEnvelope {
    constructor(context, gain = 1) {
        this.context = context;
        this.output = this.context.createGain();
        this.output.gain.value = gain;
        this.partials = [];
        this.velocity = 0;
        this.gain = gain;
        this._attack = 0;
        this._decay = 0.001;
        this._sustain = this.output.gain.value;
        this._release = 0.001;
    }

    on(velocity) {
        this.velocity = velocity / 127;
        this.start(this.context.currentTime);
    }

    off(MidiEvent) {
        return this.stop(this.context.currentTime);
    }

    start(time) {
        this.output.gain.value = 0;
        this.output.gain.setValueAtTime(0, time);
        this.output.gain.setTargetAtTime(1, time, this.attack + 0.00001);
        this.output.gain.setTargetAtTime(this.sustain * this.velocity, time + this.attack, this.decay);
    }

    stop(time) {
        this.sustain = this.output.gain.value;
        this.output.gain.cancelScheduledValues(time);
        this.output.gain.setValueAtTime(this.sustain, time);
        this.output.gain.setTargetAtTime(0, time, this.release + 0.00001);
    }

    set attack(value) {
        this._attack = value;
    }

    get attack() {
        return this._attack
    }

    set decay(value) {
        this._decay = value;
    }

    get decay() {
        return this._decay;
    }

    set sustain(value) {
        this.gain = value;
        this._sustain;
    }

    get sustain() {
        return this.gain;
    }

    set release(value) {
        this._release = value;
    }

    get release() {
        return this._release;
    }

    connect(destination) {
        this.output.connect(destination);
    }
}

class Voice {
    constructor(context, type = "sawtooth", gain = 0.1) {
        this.context = context;
        this.type = type;
        this.value = -1;
        this.gain = gain;
        this.output = this.context.createGain();
        this.partials = [];
        this.output.gain.value = this.gain;
        this.ampEnvelope = new AmpEnvelope(this.context);
        this.ampEnvelope.connect(this.output);
    }

    init() {
        let osc = this.context.createOscillator();
        osc.type = this.type;
        osc.connect(this.ampEnvelope.output);
        osc.start(this.context.currentTime);
        this.partials.push(osc);
    }

    on(MidiEvent) {
        this.value = MidiEvent.value;
        this.partials.forEach((osc) => {
            osc.frequency.value = MidiEvent.frequency;
        });
        this.ampEnvelope.on(MidiEvent.velocity || MidiEvent);
    }

    off(MidiEvent) {
        this.ampEnvelope.off(MidiEvent);
        this.partials.forEach((osc) => {
            osc.stop(this.context.currentTime + this.ampEnvelope.release * 4);
        });
    }

    connect(destination) {
        this.output.connect(destination);
    }

    set detune(value) {
        this.partials.forEach(p => p.detune.value = value);
    }

    set attack(value) {
        this.ampEnvelope.attack = value;
    }

    get attack() {
        return this.ampEnvelope.attack;
    }

    set decay(value) {
        this.ampEnvelope.decay = value;
    }

    get decay() {
        return this.ampEnvelope.decay;
    }

    set sustain(value) {
        this.ampEnvelope.sustain = value;
    }

    get sustain() {
        return this.ampEnvelope.sustain;
    }

    set release(value) {
        this.ampEnvelope.release = value;
    }

    get release() {
        return this.ampEnvelope.release;
    }

}
class Noise extends Voice {
    constructor(context, gain) {
        super(context, gain);
        this._length = 2;
    }

    get length() {
        return this._length || 2;
    }
    set length(value) {
        this._length = value;
    }

    init() {
        var lBuffer = new Float32Array(this.length * this.context.sampleRate);
        var rBuffer = new Float32Array(this.length * this.context.sampleRate);
        for (let i = 0; i < this.length * this.context.sampleRate; i++) {
            lBuffer[i] = 1 - (2 * Math.random());
            rBuffer[i] = 1 - (2 * Math.random());
        }
        let buffer = this.context.createBuffer(2, this.length * this.context.sampleRate, this.context.sampleRate);
        buffer.copyToChannel(lBuffer, 0);
        buffer.copyToChannel(rBuffer, 1);

        let osc = this.context.createBufferSource();
        osc.buffer = buffer;
        osc.loop = true;
        osc.loopStart = 0;
        osc.loopEnd = 2;
        osc.start(this.context.currentTime);
        osc.connect(this.ampEnvelope.output);
        this.partials.push(osc);
    }

    on(MidiEvent) {
        this.value = MidiEvent.value;
        this.ampEnvelope.on(MidiEvent.velocity || MidiEvent);
    }

}

class Filter extends Effect {
    constructor(context, type = "lowpass", cutoff = 1000, resonance = 0.9) {
        super(context);
        this.name = "filter";
        this.effect.frequency.value = cutoff;
        this.effect.Q.value = resonance;
        this.effect.type = type;
    }

    setup() {
        this.effect = this.context.createBiquadFilter();
        this.effect.connect(this.output);
        this.wireUp();
    }

}

var OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
class SimpleReverb extends Effect {
    constructor(context) {
        super(context);
        this.name = "SimpleReverb";
    }

    setup(reverbTime = 1) {
        this.effect = this.context.createConvolver();

        this.reverbTime = reverbTime;

        this.attack = 0.0001;
        this.decay = 0.1;
        this.release = reverbTime;

        this.wet = this.context.createGain();
        this.input.connect(this.wet);
        this.wet.connect(this.effect);
        this.effect.connect(this.output);

        this.renderTail();
    }

    renderTail() {
        console.log("renderTail")
        const tailContext = new OfflineAudioContext(2, this.context.sampleRate * this.reverbTime, this.context.sampleRate);
        tailContext.oncomplete = (buffer) => {
            this.effect.buffer = buffer.renderedBuffer;
        }

        const tailOsc = new Noise(tailContext, 1);
        tailOsc.init();
        tailOsc.connect(tailContext.destination);
        tailOsc.attack = this.attack;
        tailOsc.decay = this.decay;
        tailOsc.release = this.release;


        tailOsc.on({
            frequency: 500,
            velocity: 1
        });
        tailContext.startRendering();
        setTimeout(() => {
            tailOsc.off();
        }, 1);


    }

    set decayTime(value) {
        let dc = value / 3;
        this.reverbTime = value;
        this.release = dc;
        return this.renderTail();
    }

}

class AdvancedReverb extends SimpleReverb {
    constructor(context) {
        super(context);
        this.name = "AdvancedReverb";
    }

    setup(reverbTime = 1, preDelay = 0.03) {
        this.effect = this.context.createConvolver();

        this.reverbTime = reverbTime;

        this.attack = 0.0001;
        this.decay = 0.1;
        this.release = reverbTime / 3;

        this.preDelay = this.context.createDelay(reverbTime);
        this.preDelay.delayTime.setValueAtTime(preDelay, this.context.currentTime);

        this.multitap = [];

        for (let i = 2; i > 0; i--) {
            this.multitap.push(this.context.createDelay(reverbTime));
        }
        this.multitap.map((t, i) => {
            if (this.multitap[i + 1]) {
                t.connect(this.multitap[i + 1])
            }
            t.delayTime.setValueAtTime(0.001 + (i * (preDelay / 2)), this.context.currentTime);
        })

        this.multitapGain = this.context.createGain();
        this.multitap[this.multitap.length - 1].connect(this.multitapGain);

        this.multitapGain.gain.value = 0.2;

        this.multitapGain.connect(this.output);

        this.wet = this.context.createGain();

        this.input.connect(this.wet);
        this.wet.connect(this.preDelay);
        this.wet.connect(this.multitap[0]);
        this.preDelay.connect(this.effect);
        this.effect.connect(this.output);

    }
    renderTail() {

        const tailContext = new OfflineAudioContext(2, this.context.sampleRate * this.reverbTime, this.context.sampleRate);
        tailContext.oncomplete = (buffer) => {
            this.effect.buffer = buffer.renderedBuffer;
        }
        const tailOsc = new Noise(tailContext, 1);
        const tailLPFilter = new Filter(tailContext, "lowpass", 5000, 1);
        const tailHPFilter = new Filter(tailContext, "highpass", 500, 1);

        tailOsc.init();
        tailOsc.connect(tailHPFilter.input);
        tailHPFilter.connect(tailLPFilter.input);
        tailLPFilter.connect(tailContext.destination);
        tailOsc.attack = this.attack;
        tailOsc.decay = this.decay;
        tailOsc.release = this.release;

        tailContext.startRendering()

        tailOsc.on({
            frequency: 500,
            velocity: 1
        });
        setTimeout(() => {
            tailOsc.off();
        }, 1)
    }

    set decayTime(value) {
        let dc = value / 3;
        this.reverbTime = value;
        this.release = dc;
        this.renderTail();
    }
}


let Audio = new(window.AudioContext || window.webkitAudioContext)();

let filter = new Filter(context, "lowpass", 50000, 0.8);
filter.setup();
let verb = new SimpleReverb(context);
verb.decayTime = 0.8;
verb.wet.gain.value = 2;


let compressor = context.createDynamicsCompressor();
compressor.threshold.setValueAtTime(-24, context.currentTime);
compressor.knee.setValueAtTime(40, context.currentTime);
compressor.ratio.setValueAtTime(12, context.currentTime);
compressor.attack.setValueAtTime(0, context.currentTime);
compressor.release.setValueAtTime(0.25, context.currentTime);
compressor.connect(context.destination);

filter.connect(verb.input);
verb.connect(compressor);

function setupEventListeners() {
    window.addEventListener('resize', resize)

    volume.addEventListener('input', e => {
        const value = parseFloat(e.target.value)
        gainNode.gain.setTargetAtTime(value, context.currentTime, .01)
    })

    bass.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        bassEQ.gain.setTargetAtTime(value, context.currentTime, .01)
    })

    mid.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        midEQ.gain.setTargetAtTime(value, context.currentTime, .01)
    })

    treble.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        trebleEQ.gain.setTargetAtTime(value, context.currentTime, .01)
    })

    distortion_filter.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        dist1.curve = makeDistortionCurve(value)
    })

    reverb_attack.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        verb.decayTime = value
    })

    reverb_depth.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        verb.wet.gain.value = value;
    })

    crunch_filter.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        dist.curve = makeDistortionCurve(value)
    })

    delay_filter.addEventListener('input', e => {
        const value = parseInt(e.target.value)
        delay.delayTime.value = value
    })
}


// const master = context.createGain();
// master.gain.value = 0.8;
// master.connect(context.destination);

var delay = context.createDelay()
delay.delayTime.value = 0.5
    // delay.connect(master)

const feedback = context.createGain();
feedback.gain.value = 0.3;



var buf = 0;
async function setupContext() {

    const guitar = await getGuitar()
    if (context.state === 'suspended') {
        await context.resume()
    }
    var source = context.createMediaStreamSource(guitar)
    if (buf === 1) {
        alert(buf)
    }

    // delay.connect(feedback)
    // feedback.connect(delay)
    // delay.connect(master)

    source
        .connect(analyserNode)
        .connect(bassEQ)
        .connect(midEQ)
        .connect(trebleEQ)
        .connect(gainNode)
        // .connect(delay)
        // .connect(feedback)
        // .connect(delay)


    // .connect(filter.input) //reverb
    // .connect(delay) //delay
    // .connect(dist1) //distortion
    // .connect(dist)
    .connect(context.destination);



    var flagDist = false
    var flagBoost = false
    var flagReverb = false
    var flagDelay = false


    document.getElementById('dist').onclick = () => {
        flagDist = !flagDist
        dist.disconnect()
        if (flagDist) {
            console.log(`dist: ${flagDist}`)
            document.getElementById('dist').style.backgroundColor = "red"
            source
                .connect(bassEQ)
                .connect(midEQ)
                .connect(trebleEQ)
                .connect(gainNode)
                .connect(dist1) //distortion
                .connect(dist)
                // .connect(analyserNode)
                .connect(context.destination);
        } else {
            document.getElementById('dist').style.backgroundColor = "gray"
            dist.disconnect()
            dist1.disconnect()
        }
    }

    document.getElementById('boost').onclick = () => {
        flagBoost = !flagBoost
        console.log(`boost: ${flagBoost}`)
        dist.disconnect()
        if (flagBoost) {
            document.getElementById('boost').style.backgroundColor = "red"
            source
                .connect(bassEQ)
                .connect(midEQ)
                .connect(trebleEQ)
                .connect(gainNode)
                .connect(dist)
                // .connect(analyserNode)
                .connect(context.destination);
        } else {
            document.getElementById('boost').style.backgroundColor = "gray"
            dist.disconnect()
        }
    }

    document.getElementById('reverb').onclick = () => {
        flagReverb = !flagReverb
        console.log(`reverb: ${flagReverb}`)
        dist.disconnect()
        if (flagReverb) {
            document.getElementById('reverb').style.backgroundColor = "red"
            source
                .connect(bassEQ)
                .connect(midEQ)
                .connect(trebleEQ)
                .connect(gainNode)
                .connect(filter.input) //reverb
                // .connect(analyserNode)
                .connect(context.destination);
        } else {
            document.getElementById('reverb').style.backgroundColor = "gray"
            filter.input.disconnect()
        }
    }

    document.getElementById('delay').onclick = () => {
        flagDelay = !flagDelay
        console.log(`delay: ${flagDelay}`)
        delay.disconnect()
        if (flagDelay) {
            source = context.createMediaStreamSource(guitar)
            document.getElementById('delay').style.backgroundColor = "red"
            source
                .connect(bassEQ)
                .connect(midEQ)
                .connect(trebleEQ)
                .connect(gainNode)
                .connect(delay) //delay
                // .connect(analyserNode)
                .connect(context.destination);
        } else {
            document.getElementById('delay').style.backgroundColor = "gray"
            delay.disconnect()
            dist.disconnect()
        }
    }

}

function getGuitar() {
    return navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            latency: 0
        }
    })
}

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer)

    const bufferLength = analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyserNode.getByteFrequencyData(dataArray)
    const width = visualizer.width
    const height = visualizer.height
    const barWidth = width * 10 / bufferLength

    const canvasContext = visualizer.getContext('2d')
    canvasContext.clearRect(0, 0, width, height)

    dataArray.forEach((item, index) => {
        const y = item / 255 * height
        const x = barWidth * index

        canvasContext.fillStyle = `hsl(${y / height * 400}, 100%, 50%)`
        canvasContext.fillRect(x, height - y, barWidth, y)
    })
}

function resize() {
    visualizer.width = visualizer.clientWidth * window.devicePixelRatio
    visualizer.height = visualizer.clientHeight * window.devicePixelRatio
}