"""Two-stream upwind CDU coupled to the existing secondary-loop/solid model.

The primary liquid has explicitly supplied positive hold-up; it flows opposite
to the secondary CDU cells. Every interfacial heat rate is applied with equal
and opposite signs. Prescribed supply and a mixed return buffer define the
external boundary. Fixed properties/UA and negligible wall capacity are assumptions.
The MIT upstream modules used below retain their license and legacy behavior.
"""
import copy
import numbers
import numpy as np
from scipy import sparse
from scipy.linalg import expm
from scipy.sparse.linalg import spsolve

from research.thermal_reference import loop_1d as legacy, convection
from research.thermal_reference.epsilon_ntu import epsilon_ntu_counterflow
from research.thermal_reference.numerics import integrate, power_signal, time_axis


def positive(value, name, zero=False):
    if isinstance(value,(bool,np.bool_)) or not isinstance(value,numbers.Real) or not np.isfinite(value) or (value<0 if zero else value<=0):
        raise ValueError(name+" must be finite and "+("nonnegative" if zero else "positive"))
    return float(value)


def parameters(config, cells=None, primary_flow=None, primary_volume=None):
    """Declared example only; never infer primary hold-up from the loop or UA."""
    cells=config["reported_cells"] if cells is None else cells
    cells=positive(cells,"cells")
    if not cells.is_integer() or cells<5 or cells%5:
        raise ValueError("cells must be an integer multiple of five for aligned physical zones")
    cells=int(cells)
    geom=legacy.make_loop_geometry(N=cells)
    # Fixed example source [0,0.8] m / CDU [1.6,2.4] m in a 4 m loop.
    geom["idx_cp"]=np.arange(cells//5)
    geom["idx_cdu"]=np.arange(2*cells//5,3*cells//5)
    geom["N_cp"]=geom["N_cdu"]=cells//5
    p=legacy.default_params_1d(n_gpus=config["n_gpus"],geom=geom)
    p.update(m_dot=config["secondary_flow_kg_s"],
             m_dot_fac=config["primary_design_flow_kg_s"] if primary_flow is None else primary_flow,
             T_fac_in=config["facility_inlet_C"],
             primary_volume_m3=config["primary_volume_m3"] if primary_volume is None else primary_volume,
             primary_cp=config["primary_cp_J_kgK"],primary_rho=config["primary_density_kg_m3"])
    return p


def cdu_steady(hot_in, cold_in, hot_capacity, cold_capacity, ua, cells):
    """Independent steady component boundary solve; no temperature clipping.

    s_j/h_j are co-located mixed-cell bulk temperatures; primary upstream is
    j+1, secondary upstream j-1. The primary inlet is at the opposite end.
    """
    ch=positive(hot_capacity,"hot capacity rate");cc=positive(cold_capacity,"cold capacity rate")
    ua=positive(ua,"CDU UA",zero=True)
    cells=positive(cells,"CDU cells")
    if not cells.is_integer():
        raise ValueError("CDU cells must be a positive integer")
    cells=int(cells);k=ua/cells
    for name,t in [("hot inlet",hot_in),("cold inlet",cold_in)]:
        if not np.isfinite(t) or t<=-273.15:raise ValueError(name+" must be above absolute zero")
    matrix=sparse.lil_matrix((2*cells,2*cells));b=np.zeros(2*cells)
    for j in range(cells):
        matrix[j,j]=ch+k;matrix[j,cells+j]=-k
        if j:matrix[j,j-1]=-ch
        else:b[j]=ch*hot_in
        matrix[cells+j,cells+j]=cc+k;matrix[cells+j,j]=-k
        if j<cells-1:matrix[cells+j,cells+j+1]=-cc
        else:b[cells+j]=cc*cold_in
    state=spsolve(matrix.tocsc(),b);hot,cold=state[:cells],state[cells:]
    return hot,cold


class Model:
    """Frozen parameter instance: one conservative RHS for all transient runs."""
    def __init__(self,p):
        self.p=copy.deepcopy(p);p=self.p;g=p["geom"]
        self.n=int(g["N"]);self.m=int(g["N_cdu"]);self.size=4+self.n+self.m
        if self.n<1 or len(g["idx_cp"])!=g["N_cp"] or len(g["idx_cdu"])!=self.m:
            raise ValueError("Inconsistent loop/source/CDU geometry")
        cp_idx=np.asarray(g["idx_cp"]);hx_idx=np.asarray(g["idx_cdu"])
        if not len(cp_idx) or not len(hx_idx) or not np.issubdtype(cp_idx.dtype,np.integer) or not np.issubdtype(hx_idx.dtype,np.integer):
            raise ValueError("Source/CDU indices must be nonempty integer arrays")
        if not np.array_equal(cp_idx,np.arange(len(cp_idx))) or cp_idx[-1]>=hx_idx[0] or not np.array_equal(hx_idx,np.arange(hx_idx[0],hx_idx[0]+self.m)) or max(hx_idx)>=self.n:
            raise ValueError("Supported topology needs an initial contiguous source, then a disjoint contiguous CDU inside the loop")
        positive(g["m_cell"],"secondary cell mass")
        for key in ["m_dot","m_dot_fac","cp_water","primary_cp","primary_rho","primary_volume_m3","C_die","C_ihs","C_cp","C_fac","R_j_ihs","R_ihs_cp","A_cp"]:
            if key not in p:raise ValueError("Supply physical parameter "+key+" explicitly; missing quantities are not inferred")
            positive(p[key],key)
        positive(p["UA_hx_total"],"UA_hx_total",zero=True)
        if not np.isfinite(p["T_fac_in"]) or p["T_fac_in"]<=-273.15:raise ValueError("Supply temperature must be above absolute zero")
        self.convection=convection.evaluate(p,emit_warnings=False)
        self.ha=self.convection["h_W_m2K"]*p["A_cp"]*p["n_gpus"]
        self.ch=p["m_dot"]*p["cp_water"];self.cc=p["m_dot_fac"]*p["primary_cp"]
        positive(self.ch,"secondary capacity rate");positive(self.cc,"primary capacity rate")
        positive(self.ha,"cold-plate conductance")
        self.weights=np.r_[[p[k] for k in ["C_die","C_ihs","C_cp"]],
                           np.full(self.n,g["m_cell"]*p["cp_water"]),
                           np.full(self.m,p["primary_volume_m3"]*p["primary_rho"]*p["primary_cp"]/self.m),p["C_fac"]]
        if not np.isfinite(self.weights).all() or (self.weights<=0).any():raise ValueError("All thermal capacitances must remain finite and positive")

    def rates(self,state,power):
        """Return dT/dt; power is W/GPU, enthalpy flows are W."""
        p=self.p;g=p["geom"];t=np.asarray(state,dtype=float)
        if t.shape!=(self.size,) or not np.isfinite(t).all() or (t<=-273.15).any():
            raise ValueError("All model states must be finite temperatures above absolute zero")
        power=positive(power,"per-GPU power",zero=True)
        secondary=t[3:3+self.n];primary=t[3+self.n:-1]
        energy=np.zeros(self.size)
        q1=(t[0]-t[1])*p["n_gpus"]/p["R_j_ihs"]
        q2=(t[1]-t[2])*p["n_gpus"]/p["R_ihs_cp"]
        qcp=self.ha/g["N_cp"]*(t[2]-secondary[g["idx_cp"]])
        qhx=p["UA_hx_total"]/self.m*(secondary[g["idx_cdu"]]-primary)
        energy[:3]=[power*p["n_gpus"]-q1,q1-q2,q2-qcp.sum()]
        liquid=energy[3:3+self.n]
        liquid[:]=self.ch*(np.roll(secondary,1)-secondary)
        liquid[g["idx_cp"]]+=qcp;liquid[g["idx_cdu"]]-=qhx
        energy[3+self.n:-1]=self.cc*(np.r_[primary[1:],p["T_fac_in"]]-primary)+qhx
        energy[-1]=self.cc*(primary[0]-t[-1])
        return energy/self.weights

    def rejected(self,state):
        return self.cc*(state[-1]-self.p["T_fac_in"])

    def exchange_entropy(self,state):
        """Interfacial conductive entropy generation only, not total entropy balance."""
        p=self.p;g=p["geom"];t=np.asarray(state)+273.15
        if not np.isfinite(t).all() or (t<=0).any():raise ValueError("Entropy requires positive absolute temperatures")
        sec=t[3:3+self.n];pri=t[3+self.n:-1]
        def pair(a,b,k):return k*(a-b)**2/(a*b)
        return float(pair(t[0],t[1],p["n_gpus"]/p["R_j_ihs"])+pair(t[1],t[2],p["n_gpus"]/p["R_ihs_cp"])+
            pair(t[2],sec[g["idx_cp"]],self.ha/g["N_cp"]).sum()+
            pair(sec[g["idx_cdu"]],pri,p["UA_hx_total"]/self.m).sum())

    def steady(self,power):
        """Independent component recurrence/reference for the same discrete model."""
        p=self.p;g=p["geom"];power=positive(power,"per-GPU power",zero=True)
        if p["UA_hx_total"]<=0:raise ValueError("No unique rejected-heat steady state with zero CDU UA")
        hs,cs=cdu_steady(1.,0.,self.ch,self.cc,p["UA_hx_total"],self.m)
        conductance=p["UA_hx_total"]/self.m*np.sum(hs-cs)
        positive(conductance,"discrete CDU conductance")
        q=power*p["n_gpus"];hot_in=p["T_fac_in"]+q/conductance
        hot_out=hot_in-q/self.ch
        attenuation=-g["N_cp"]*np.log1p(self.ha/(g["N_cp"]*self.ch))
        plate=hot_out+(q/self.ch)/(-np.expm1(attenuation))
        hot,cold=cdu_steady(hot_in,p["T_fac_in"],self.ch,self.cc,p["UA_hx_total"],self.m)
        profile=np.empty(self.n);value=hot_out
        cp_cells=set(g["idx_cp"]);hx_map={int(index):j for j,index in enumerate(g["idx_cdu"])}
        for i in range(self.n):
            if i in cp_cells:value=(self.ch*value+self.ha/g["N_cp"]*plate)/(self.ch+self.ha/g["N_cp"])
            if i in hx_map:value=hot[hx_map[i]]
            profile[i]=value
        return np.r_[plate+power*(p["R_j_ihs"]+p["R_ihs_cp"]),plate+power*p["R_ihs_cp"],plate,profile,cold,p["T_fac_in"]+q/self.cc]

    def continuum(self,power):
        """Analytical zero-cell-width limit, not an independent experiment."""
        p=self.p;power=positive(power,"per-GPU power",zero=True)
        eps,cmin=epsilon_ntu_counterflow(p["m_dot"],p["m_dot_fac"],p["cp_water"],p["primary_cp"],p["UA_hx_total"])
        if eps*cmin<=0:raise ValueError("No unique rejected-heat continuum steady state")
        q=power*p["n_gpus"];hot_in=p["T_fac_in"]+q/(eps*cmin);hot_out=hot_in-q/self.ch
        plate=hot_out+q/self.ch/(-np.expm1(-self.ha/self.ch))
        return {"T_die_C":float(plate+power*(p["R_j_ihs"]+p["R_ihs_cp"])),"effectiveness":float(eps),
                "hot_in_C":float(hot_in),"hot_out_C":float(hot_out),"primary_out_C":float(p["T_fac_in"]+q/self.cc)}


def simulate(model,times,powers,input_times,controls,initial=None,*,breakpoints=()):
    """Default to equilibrium at the actual output start, not the first input sample.

    Callables are supported by adaptive integration; supply known discontinuity
    times explicitly in breakpoints. Parameters remain fixed for this run.
    """
    t=time_axis(times);power,changes=power_signal(t,powers,input_times)
    if initial is None:initial=model.steady(power(t[0]))
    def rhs(now,y):
        watts=power(now)
        return np.r_[model.rates(y[:-2],watts),model.rejected(y[:-2])/1e6,watts*model.p["n_gpus"]/1e6]
    sol=integrate(rhs,t,np.r_[initial,0.,0.],breakpoints=[*changes,*breakpoints],**controls)
    return {"t":t,"temperatures":sol.y[:-2],"rejected_J":sol.y[-2]*1e6,"input_J":sol.y[-1]*1e6,"evaluations":sol.nfev}


def exponential_reference(model,times,powers,input_times,initial=None):
    """Dense matrix exponential, independent integration for fixed linear physics.

    This verification helper requires a uniform observation grid containing
    every input change. No claimed generic discontinuity interpolation.
    """
    t=time_axis(times);dt=t[1]-t[0]
    if callable(powers):raise ValueError("Exponential reference requires timestamped sampled powers with certified constant segments")
    if not np.allclose(np.diff(t),dt,atol=1e-10,rtol=0):raise ValueError("Exponential check requires uniform observation times")
    power,changes=power_signal(t,powers,input_times)
    if any(t[0]<c<t[-1] and not np.any(np.isclose(t,c,atol=1e-10,rtol=0)) for c in changes):
        raise ValueError("Observation grid must include each input discontinuity")
    n=model.size;origin=np.full(n,model.p["T_fac_in"])
    matrix=np.column_stack([model.rates(origin+np.eye(1,n,i)[0],0) for i in range(n)])
    generator=np.zeros((n+3,n+3));generator[:n,:n]=matrix
    generator[0,-1]=model.p["n_gpus"]/(model.weights[0]*100)
    generator[n,n-1]=model.cc*100/1e6;generator[n+1,-1]=model.p["n_gpus"]/1e6
    advance=expm(generator*dt)
    if initial is None:initial=model.steady(power(t[0]))
    state=np.r_[(np.asarray(initial)-origin)/100,0.,0.,power(t[0])]
    result=np.empty((n+3,len(t)));result[:,0]=state
    for i in range(len(t)-1):
        state[-1]=power(t[i]);state=advance@state;result[:,i+1]=state
    return {"t":t,"temperatures":origin[:,None]+result[:n]*100,"rejected_J":result[n]*1e6,"input_J":result[n+1]*1e6}
