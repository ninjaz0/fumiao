"""Monotonic local stage measurements; snapshots contain no prompt or paths."""
import os
import threading
import time
from node_models import VIDEO_SAMPLING_STEPS, H3_TURBO_WORKFLOW

FAST_I2V = os.getenv("FUMIAO_H3_FAST_I2V", "0") == "1"
WORKFLOW = H3_TURBO_WORKFLOW
SUPPORTED_STEPS = VIDEO_SAMPLING_STEPS


class JobClock:
    def __init__(self, cold, recovered=False, clock=time.monotonic, steps=20):
        self.steps = steps
        self.clock = clock
        self.lock = threading.Lock()
        self.start = clock()
        self.generating = None
        self.finalizing = None
        self.uploading = None
        self.cold = cold
        self.recovered = recovered
        self.phase = 'preparing'
        self.resources = {}

    def record_resources(self,stats):
        with self.lock:
            for source,target in [('peak_bytes','peak_vram_bytes'),('peak_allocated_bytes','peak_allocated_vram_bytes')]:
                if type(stats.get(source)) is int and stats[source]>=0:self.resources[target]=stats[source]

    def observe_sampling(self, step=None, steps=None):
        if step is None or steps != self.steps or not 0 <= step <= steps:
            return
        with self.lock:
            stamp = self.clock()
            if step < steps and self.generating is None and self.finalizing is None:
                self.generating = stamp
                self.phase = 'generating'
            if step == steps and self.finalizing is None:
                self.finalizing = stamp
                self.phase = 'finalizing'

    def finish_render(self, cached=False):
        with self.lock:
            self.finalizing = self.finalizing or self.clock()
            self.phase = 'finalizing'
            self.recovered = self.recovered or cached

    def begin_upload(self):
        with self.lock:
            self.uploading = self.clock()
            self.phase = 'uploading'

    def snapshot(self):
        with self.lock:
            values = {'cold':self.cold,'recovered':self.recovered,'sampling_steps':self.steps,'fast_mode':self.steps==4}
            values.update(self.resources)
            if self.generating is not None:
                values['prepare_s'] = round(self.generating-self.start,3)
                if self.finalizing is not None:
                    values['generate_s'] = round(self.finalizing-self.generating,3)
            if self.finalizing is not None and self.uploading is not None:
                values['finalize_s'] = round(self.uploading-self.finalizing,3)
            return self.phase, values


def sampling_steps(job):
    if 'sampling_steps' in job:
        value=job['sampling_steps']
        if type(value) is not int or value not in SUPPORTED_STEPS:raise ValueError('不支持的采样步数')
        return value
    # Only pre-update local recovery files may lack an explicit requested count.
    return 4 if FAST_I2V and len(job["refs"]) == 1 and int(job["quality"]) == 768 else 20
