import pandas as pd
import plotly.graph_objects as go
import gdown
import streamlit as st

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

    df["UTC"] = pd.to_datetime(
        df["UTC"],
        format="mixed",
        utc=True
    )

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
# HEADER
# -------------------------

st.title("SAA Manual Labeling Tool")

annotator = st.text_input("Volunteer Name")

# -------------------------
# DATE COLUMN
# -------------------------

df["date"] = df["UTC"].dt.date
days = sorted(df["date"].unique())

selected_day = days[st.session_state.day_index]

# -------------------------
# NAVIGATION
# -------------------------

nav1, nav2 = st.columns(2)

with nav1:
    if st.button("Previous Day"):
        st.session_state.day_index = max(0, st.session_state.day_index - 1)
        st.session_state.click_times = []

with nav2:
    if st.button("Next Day"):
        st.session_state.day_index = min(len(days) - 1, st.session_state.day_index + 1)
        st.session_state.click_times = []

# -------------------------
# DAY DISPLAY
# -------------------------

st.subheader(
    f"Day {st.session_state.day_index + 1} of {len(days)}"
)

st.write(
    f"Date: {selected_day}"
)

# -------------------------
# PROGRESS
# -------------------------

completed = len(st.session_state.completed_days)

st.metric("Completed Days", f"{completed}")
st.metric("Volunteer Target", f"{completed}/10")

st.progress(min(completed / 10, 1.0))

# -------------------------
# INSTRUCTIONS
# -------------------------

st.info("""
Instructions

• Click anywhere on the graph → start SAA
• Click again → end SAA
• Save label
• Mark day complete when done

Rules:
• UTC data only
• Two clicks = one interval
""")

# -------------------------
# FILTER DATA
# -------------------------

day_df = df[df["date"] == selected_day]
plot_df = day_df.iloc[::10]

# -------------------------
# NASA OVERLAY
# -------------------------

show_nasa = st.checkbox("Show NASA SRAG Labels", value=True)

# -------------------------
# PLOT (CLICK ANYWHERE FIX)
# -------------------------

fig = go.Figure()

# 🔥 KEY FIX: invisible markers make whole line clickable
fig.add_trace(
    go.Scatter(
        x=plot_df["UTC"],
        y=plot_df["flux"],
        mode="lines+markers",
        marker=dict(
            size=6,
            opacity=0   # invisible click layer
        ),
        line=dict(width=2),
        name="Flux"
    )
)

if show_nasa and "SAA" in plot_df.columns:

    nasa_df = plot_df[plot_df["SAA"] == 1]

    fig.add_trace(
        go.Scatter(
            x=nasa_df["UTC"],
            y=nasa_df["flux"],
            mode="markers",
            name="NASA SAA"
        )
    )

fig.update_layout(
    height=700,
    yaxis_type="log",
    xaxis_title="UTC",
    yaxis_title="Flux"
)

# -------------------------
# CLICK HANDLING
# -------------------------

event = st.plotly_chart(
    fig,
    use_container_width=True,
    on_select="rerun"
)

# extract click (works via selected points)
if event is not None:
    try:
        points = event["selection"]["points"]

        for p in points:
            if len(st.session_state.click_times) < 2:
                st.session_state.click_times.append(p["x"])

    except:
        pass

# -------------------------
# SHOW SELECTION
# -------------------------

st.subheader("Current Selection")

if len(st.session_state.click_times) == 1:
    st.info(f"Start: {st.session_state.click_times[0]}")

elif len(st.session_state.click_times) == 2:
    st.success(
        f"Start: {st.session_state.click_times[0]} | End: {st.session_state.click_times[1]}"
    )

else:
    st.write("Click two points on graph")

# -------------------------
# SAVE LABEL
# -------------------------

st.subheader("Add SAA Label")

if st.button("Save Label"):

    try:
        if len(st.session_state.click_times) != 2:
            st.error("Click 2 points first")
            st.stop()

        start_dt = pd.to_datetime(st.session_state.click_times[0], utc=True)
        end_dt = pd.to_datetime(st.session_state.click_times[1], utc=True)

        if start_dt >= end_dt:
            st.error("Start must be before end")

        else:
            st.session_state.labels.append(
                {
                    "annotator": annotator,
                    "date": str(selected_day),
                    "start": start_dt.isoformat(),
                    "end": end_dt.isoformat(),
                    "label": "SAA"
                }
            )

            st.success("Label Saved")
            st.session_state.click_times = []

    except:
        st.error("Error saving label")

# -------------------------
# COMPLETE DAY
# -------------------------

if st.button("Mark Day Complete"):
    st.session_state.completed_days.add(str(selected_day))
    st.success("Day complete")

# -------------------------
# SAVED LABELS
# -------------------------

st.subheader("Saved Labels")

labels_df = pd.DataFrame(st.session_state.labels)

if len(labels_df) > 0:

    st.write(f"Total Labels: {len(st.session_state.labels)}")
    st.dataframe(labels_df, use_container_width=True)

    csv = labels_df.to_csv(index=False).encode()

    st.download_button(
        "Download Labels CSV",
        csv,
        file_name="saa_labels.csv",
        mime="text/csv"
    )

# -------------------------
# COMPLETED DAYS
# -------------------------

if len(st.session_state.completed_days) > 0:

    st.subheader("Completed Days")

    completed_df = pd.DataFrame(
        sorted(st.session_state.completed_days),
        columns=["Day"]
    )

    st.dataframe(completed_df, use_container_width=True)
