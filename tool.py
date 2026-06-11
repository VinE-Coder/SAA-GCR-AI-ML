import pandas as pd
import plotly.graph_objects as go
import gdown
import streamlit as st
import numpy as np

st.set_page_config(
    page_title="SAA Manual Labeling Tool",
    layout="wide"
)

# -------------------------
# LOAD DATA
# -------------------------

@st.cache_data
def load_data():

    file_id = "1gpqXHXpY7BEdvzvAqR4PKHRmxHYzph4K"

    gdown.download(
        f"https://drive.google.com/uc?id={file_id}",
        "data.csv",
        quiet=True
    )

    df = pd.read_csv("data.csv")

    df["UTC"] = pd.to_datetime(df["UTC"], format="mixed", utc=True)

    df = df.sort_values("UTC")

    return df


df = load_data()

# -------------------------
# SESSION STATE
# -------------------------

if "labels" not in st.session_state:
    st.session_state.labels = []

if "completed_days" not in st.session_state:
    st.session_state.completed_days = set()

if "day_index" not in st.session_state:
    st.session_state.day_index = 0

if "click_times" not in st.session_state:
    st.session_state.click_times = []

# -------------------------
# PREP DATA
# -------------------------

df["date"] = df["UTC"].dt.date
days = sorted(df["date"].unique())
selected_day = days[st.session_state.day_index]

day_df = df[df["date"] == selected_day]
plot_df = day_df.iloc[::10].copy()

# convert timestamps for mapping
times = plot_df["UTC"].astype("int64").values  # nanoseconds

# -------------------------
# HEADER
# -------------------------

st.title("SAA Manual Labeling Tool (Click Anywhere Version)")
st.write(f"Date: {selected_day}")

# -------------------------
# NAV
# -------------------------

col1, col2 = st.columns(2)

with col1:
    if st.button("Previous Day"):
        st.session_state.day_index = max(0, st.session_state.day_index - 1)
        st.session_state.click_times = []

with col2:
    if st.button("Next Day"):
        st.session_state.day_index = min(len(days) - 1, st.session_state.day_index + 1)
        st.session_state.click_times = []

# -------------------------
# PROGRESS
# -------------------------

completed = len(st.session_state.completed_days)

st.metric("Completed Days", completed)
st.metric("Target", f"{completed}/10")

# -------------------------
# PLOT
# -------------------------

fig = go.Figure()

fig.add_trace(
    go.Scatter(
        x=plot_df["UTC"],
        y=plot_df["flux"],
        mode="lines",
        name="Flux"
    )
)

fig.update_layout(
    height=700,
    yaxis_type="log",
    xaxis_title="UTC",
    yaxis_title="Flux",
    clickmode="event+select"
)

# Render plot
plot_event = st.plotly_chart(fig, use_container_width=True)

# -------------------------
# CLICK ANYWHERE SYSTEM (CORE)
# -------------------------

st.subheader("Click-to-Label System")

click_x = st.slider(
    "Simulated click position (temporary Streamlit limitation fix)",
    min_value=0,
    max_value=len(plot_df) - 1,
    value=0
)

clicked_time = plot_df.iloc[click_x]["UTC"]

if st.button("Add Click Point"):

    st.session_state.click_times.append(clicked_time)

    if len(st.session_state.click_times) > 2:
        st.session_state.click_times = st.session_state.click_times[-2:]

# -------------------------
# SHOW SELECTION
# -------------------------

if len(st.session_state.click_times) == 1:
    st.info(f"Start: {st.session_state.click_times[0]}")

elif len(st.session_state.click_times) == 2:
    st.success(
        f"Start: {st.session_state.click_times[0]} | End: {st.session_state.click_times[1]}"
    )

# -------------------------
# SAVE LABEL
# -------------------------

if st.button("Save Label"):

    try:
        if len(st.session_state.click_times) != 2:
            st.error("Need 2 click points")
            st.stop()

        start_dt = pd.to_datetime(st.session_state.click_times[0], utc=True)
        end_dt = pd.to_datetime(st.session_state.click_times[1], utc=True)

        if start_dt >= end_dt:
            st.error("Start must be before end")
        else:
            st.session_state.labels.append(
                {
                    "date": str(selected_day),
                    "start": start_dt.isoformat(),
                    "end": end_dt.isoformat(),
                    "label": "SAA"
                }
            )

            st.success("Saved!")
            st.session_state.click_times = []

    except:
        st.error("Error saving label")

# -------------------------
# LABELS TABLE
# -------------------------

st.subheader("Labels")

labels_df = pd.DataFrame(st.session_state.labels)

if len(labels_df) > 0:
    st.dataframe(labels_df, use_container_width=True)

    st.download_button(
        "Download CSV",
        labels_df.to_csv(index=False).encode(),
        file_name="saa_labels.csv"
    )

# -------------------------
# COMPLETE DAY
# -------------------------

if st.button("Mark Day Complete"):
    st.session_state.completed_days.add(str(selected_day))
    st.success("Day complete")
